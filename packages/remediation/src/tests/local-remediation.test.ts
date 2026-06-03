import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  applyApprovedProposalToTempCopy,
  createLocalRemediationExecution,
  generateFixProposal,
  runLocalRemediation,
  runRemediationVerification
} from "../index";
import type { FixProposal } from "@autocyber/core";

const approvedProposal: FixProposal = {
  id: "fix_cors",
  findingId: "finding_cors",
  repositoryId: "repo_demo",
  status: "approved",
  kind: "patch",
  title: "Restrict CORS origins",
  explanation: "Replace wildcard CORS with an allowlist.",
  proposedPatch: "Replace wildcard CORS with configured allowed origins.",
  diff: `--- a/src/server.ts
+++ b/src/server.ts
@@
-app.use(cors({ origin: "*" }));
+app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
`,
  risk: "Medium. Misconfigured origins can block clients.",
  verificationPlan: ["Rerun the unsafe-cors-wildcard scanner rule."],
  filesChanged: ["src/server.ts"],
  createdAt: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z"
};

describe("local verified remediation", () => {
  it("blocks draft and rejected proposals before remediation can run", async () => {
    const draft = await createLocalRemediationExecution({
      proposal: { ...approvedProposal, status: "draft" },
      repositoryPath: "/tmp/repo"
    });
    const rejected = await createLocalRemediationExecution({
      proposal: { ...approvedProposal, status: "rejected" },
      repositoryPath: "/tmp/repo"
    });

    expect(draft).toMatchObject({ status: "failed", error: "Fix proposal must be approved before remediation can run." });
    expect(rejected).toMatchObject({ status: "failed", error: "Fix proposal must be approved before remediation can run." });
  });

  it("applies a patch to a temporary working copy and changes only the expected file", async () => {
    const repositoryPath = await createRepositoryFixture();

    const result = await applyApprovedProposalToTempCopy({
      proposal: approvedProposal,
      repositoryPath
    });

    await expect(readFile(join(repositoryPath, "src/server.ts"), "utf8")).resolves.toContain('origin: "*"');
    await expect(readFile(join(result.workingCopyPath, "src/server.ts"), "utf8")).resolves.toContain("process.env.ALLOWED_ORIGIN");
    await expect(readFile(join(result.workingCopyPath, "README.md"), "utf8")).resolves.toBe("demo\n");
    expect(result.filesChanged).toEqual(["src/server.ts"]);
  });

  it("stores verification results after patch application", async () => {
    const repositoryPath = await createRepositoryFixture();
    const execution = await runLocalRemediation({
      proposal: approvedProposal,
      repositoryPath,
      originalFinding: {
        ruleId: "unsafe-cors-wildcard",
        affectedFile: "src/server.ts"
      }
    });

    expect(execution.status).toBe("verified");
    expect(execution.verificationResult?.status).toBe("passed");
    expect(execution.verificationResult?.checksRun.map((check) => check.name)).toContain("scanner-rule");
    expect(execution.verificationResult?.outputSummary).toContain("unsafe-cors-wildcard");
  });

  it("records skipped typecheck and test limitations without executing repo scripts by default", async () => {
    const repositoryPath = await createRepositoryFixture();
    const patchResult = await applyApprovedProposalToTempCopy({ proposal: approvedProposal, repositoryPath });
    const verification = await runRemediationVerification({
      proposal: approvedProposal,
      workingCopyPath: patchResult.workingCopyPath,
      originalFinding: {
        ruleId: "unsafe-cors-wildcard",
        affectedFile: "src/server.ts"
      }
    });

    expect(verification.checksRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "typecheck", status: "skipped" }),
        expect.objectContaining({ name: "test", status: "skipped" })
      ])
    );
    expect(verification.limitations.join("\n")).toContain("Command verification is disabled by default");
  });

  it("handles failed patch application safely", async () => {
    const repositoryPath = await createRepositoryFixture();

    const execution = await runLocalRemediation({
      proposal: {
        ...approvedProposal,
        diff: `--- a/src/server.ts
+++ b/src/server.ts
@@
-doesNotExist()
+patched()
`
      },
      repositoryPath,
      originalFinding: {
        ruleId: "unsafe-cors-wildcard",
        affectedFile: "src/server.ts"
      }
    });

    expect(execution.status).toBe("failed");
    expect(execution.error).toContain("Patch could not be applied");
    await expect(readFile(join(repositoryPath, "src/server.ts"), "utf8")).resolves.toContain('origin: "*"');
  });

  it("blocks advisory-only proposals before copying or applying patches", async () => {
    const repositoryPath = await createRepositoryFixture();

    const execution = await runLocalRemediation({
      proposal: {
        ...approvedProposal,
        id: "fix_advisory",
        kind: "advisory",
        title: "Advisory proposal",
        proposedPatch: "Manual remediation required.",
        diff: approvedProposal.diff
      },
      repositoryPath,
      originalFinding: {
        ruleId: "ai-route-missing-rate-limit",
        affectedFile: "src/server.ts"
      }
    });

    expect(execution.status).toBe("failed");
    expect(execution.workingCopyPath).toBeNull();
    expect(execution.error).toBe("This is an advisory-only proposal and cannot be automatically remediated.");
    await expect(readFile(join(repositoryPath, "src/server.ts"), "utf8")).resolves.toContain('origin: "*"');
  });

  it("blocks manual-remediation proposals even when they include a unified diff", async () => {
    const repositoryPath = await createRepositoryFixture();

    const execution = await runLocalRemediation({
      proposal: {
        ...approvedProposal,
        id: "fix_manual",
        proposedPatch: "Manual remediation required: review the route architecture.",
        diff: approvedProposal.diff
      },
      repositoryPath
    });

    expect(execution.status).toBe("failed");
    expect(execution.workingCopyPath).toBeNull();
    expect(execution.error).toBe("This is an advisory-only proposal and cannot be automatically remediated.");
  });

  it("blocks patch proposals without applyable unified diffs", async () => {
    const repositoryPath = await createRepositoryFixture();

    const execution = await runLocalRemediation({
      proposal: {
        ...approvedProposal,
        id: "fix_missing_diff",
        diff: "Review this route manually."
      },
      repositoryPath
    });

    expect(execution.status).toBe("failed");
    expect(execution.workingCopyPath).toBeNull();
    expect(execution.error).toBe("Fix proposal does not contain an applyable unified diff.");
  });

  it("redacts secrets from remediation output", async () => {
    const repositoryPath = await createRepositoryFixture();
    const secretProposal: FixProposal = {
      ...approvedProposal,
      id: "fix_secret",
      title: "Remove secret",
      diff: `--- a/.env
+++ b/.env
@@
-OPENAI_API_KEY=sk-proj-stage4secret000000000000000000
+OPENAI_API_KEY=
`,
      filesChanged: [".env"]
    };
    await writeFile(join(repositoryPath, ".env"), "OPENAI_API_KEY=sk-proj-stage4secret000000000000000000\n");

    const execution = await runLocalRemediation({
      proposal: secretProposal,
      repositoryPath,
      originalFinding: {
        ruleId: "exposed-secret",
        affectedFile: ".env"
      }
    });
    const serialized = JSON.stringify(execution);

    expect(serialized).not.toContain("stage4secret000000000000000000");
    expect(serialized).not.toContain("sk-proj-stage4secret");
  });

  it("applies missing security headers to CommonJS Next.js config files", async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), "autocyber-stage4a-next-config-"));
    await writeFile(
      join(repositoryPath, "next.config.js"),
      `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true
};

module.exports = nextConfig;
`
    );
    const proposal = generateFixProposal({
      id: "finding_headers",
      repositoryId: "repo_demo",
      title: "Next.js app does not configure baseline security headers",
      category: "missing security headers",
      severity: "medium",
      confidence: 0.72,
      status: "open",
      stackTags: ["nextjs"],
      affectedFile: "next.config.js",
      evidence: [{ filePath: "next.config.js", startLine: 1, endLine: 5, snippet: "const nextConfig = {" }],
      riskExplanation: "Missing browser security headers leaves the app with weaker defaults.",
      remediationSummary: "Add baseline security headers.",
      verificationStrategy: "Rerun the missing-security-headers scanner rule.",
      autofixAvailable: true,
      ruleId: "missing-security-headers"
    });

    const execution = await runLocalRemediation({
      proposal: { ...proposal, status: "approved" },
      repositoryPath,
      originalFinding: {
        ruleId: "missing-security-headers",
        affectedFile: "next.config.js"
      }
    });

    expect(execution.status).toBe("verified");
    expect(execution.filesChanged).toEqual(["next.config.js"]);
    await expect(readFile(join(repositoryPath, "next.config.js"), "utf8")).resolves.not.toContain("X-Frame-Options");
    await expect(readFile(join(execution.workingCopyPath!, "next.config.js"), "utf8")).resolves.toContain("X-Frame-Options");
  });
});

async function createRepositoryFixture(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), "autocyber-stage4a-test-"));
  await writeFile(join(repositoryPath, "README.md"), "demo\n");
  await writeFile(join(repositoryPath, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit", test: "vitest run" } }, null, 2));
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(repositoryPath, "src"), { recursive: true }));
  await writeFile(join(repositoryPath, "src/server.ts"), 'app.use(cors({ origin: "*" }));\n');
  return repositoryPath;
}
