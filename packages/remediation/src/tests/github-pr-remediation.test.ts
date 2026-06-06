import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createGitHubPrRemediation,
  createPullRequestBody,
  createRemediationBranchName,
  type GitHubRemediationClient,
} from "../index";
import type { FixProposal } from "@autocyber/core";
import type { LocalRemediationExecution } from "../types";

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
  updatedAt: "2026-05-28T10:00:00.000Z",
};

const verifiedExecution: LocalRemediationExecution = {
  id: "rem_fix_cors",
  fixProposalId: "fix_cors",
  repositoryId: "repo_demo",
  status: "verified",
  workingCopyPath: "",
  filesChanged: ["src/server.ts"],
  verificationResult: {
    status: "passed",
    checksRun: [
      {
        name: "scanner-rule",
        status: "passed",
        outputSummary:
          "unsafe-cors-wildcard no longer appears for src/server.ts.",
      },
      {
        name: "pattern",
        status: "passed",
        outputSummary:
          "Removed patterns are absent and added patterns are present.",
      },
    ],
    outputSummary: "scanner-rule passed and pattern passed",
    limitations: ["Typecheck command was not run."],
  },
  error: null,
  createdAt: "2026-05-28T10:01:00.000Z",
  updatedAt: "2026-05-28T10:02:00.000Z",
};

describe("GitHub PR remediation", () => {
  it("refuses unapproved proposals before GitHub writes", async () => {
    const workingCopyPath = await createWorkingCopy();
    const client = createMockClient();

    const result = await createGitHubPrRemediation({
      proposal: { ...approvedProposal, status: "draft" },
      execution: { ...verifiedExecution, workingCopyPath },
      target: createTarget(),
      client,
      now: "2026-05-28T10:03:00.000Z",
    });

    expect(result).toMatchObject({
      status: "blocked",
      pullRequestUrl: null,
      error: "Fix proposal must be approved before creating a GitHub PR.",
    });
    expect(client.calls).toEqual([]);
  });

  it("refuses failed local verification by default", async () => {
    const workingCopyPath = await createWorkingCopy();
    const client = createMockClient();

    const result = await createGitHubPrRemediation({
      proposal: approvedProposal,
      execution: {
        ...verifiedExecution,
        status: "failed",
        workingCopyPath,
        verificationResult: {
          ...verifiedExecution.verificationResult!,
          status: "failed",
        },
      },
      target: createTarget(),
      client,
    });

    expect(result.status).toBe("blocked");
    expect(result.error).toBe(
      "Local verification must pass before creating a GitHub PR.",
    );
    expect(client.calls).toEqual([]);
  });

  it("refuses advisory proposals before GitHub writes even when they include a unified diff", async () => {
    const workingCopyPath = await createWorkingCopy();
    const client = createMockClient();

    const result = await createGitHubPrRemediation({
      proposal: { ...approvedProposal, kind: "advisory" },
      execution: { ...verifiedExecution, workingCopyPath },
      target: createTarget(),
      client,
    });

    expect(result.status).toBe("blocked");
    expect(result.error).toBe(
      "This is an advisory-only proposal and cannot be automatically remediated.",
    );
    expect(client.calls).toEqual([]);
  });

  it("refuses manual-remediation proposals before GitHub writes even when they include a unified diff", async () => {
    const workingCopyPath = await createWorkingCopy();
    const client = createMockClient();

    const result = await createGitHubPrRemediation({
      proposal: {
        ...approvedProposal,
        proposedPatch:
          "Manual remediation required: review the route architecture.",
      },
      execution: { ...verifiedExecution, workingCopyPath },
      target: createTarget(),
      client,
    });

    expect(result.status).toBe("blocked");
    expect(result.error).toBe(
      "This is an advisory-only proposal and cannot be automatically remediated.",
    );
    expect(client.calls).toEqual([]);
  });

  it("refuses proposals without applyable unified diffs before GitHub writes", async () => {
    const workingCopyPath = await createWorkingCopy();
    const client = createMockClient();

    const result = await createGitHubPrRemediation({
      proposal: { ...approvedProposal, diff: "Review this route manually." },
      execution: { ...verifiedExecution, workingCopyPath },
      target: createTarget(),
      client,
    });

    expect(result.status).toBe("blocked");
    expect(result.error).toBe(
      "Fix proposal does not contain an applyable unified diff.",
    );
    expect(client.calls).toEqual([]);
  });

  it("creates a remediation branch that is never the default branch", () => {
    const branchName = createRemediationBranchName(approvedProposal, "main");

    expect(branchName).toMatch(/^autocyber\/fix-/);
    expect(branchName).not.toBe("main");
  });

  it("writes a PR body with verification evidence", () => {
    const body = createPullRequestBody({
      proposal: approvedProposal,
      execution: verifiedExecution,
      filesChanged: ["src/server.ts"],
    });

    expect(body).toContain("## What changed");
    expect(body).toContain("## Why this matters");
    expect(body).toContain("## Verification");
    expect(body).toContain("scanner-rule");
    expect(body).toContain("unsafe-cors-wildcard no longer appears");
    expect(body).toContain("## Risk");
    expect(body).toContain("## Notes");
  });

  it("commits only files recorded by the verified remediation execution", async () => {
    const workingCopyPath = await createWorkingCopy();
    const client = createMockClient();

    const result = await createGitHubPrRemediation({
      proposal: approvedProposal,
      execution: { ...verifiedExecution, workingCopyPath },
      target: createTarget(),
      client,
      now: "2026-05-28T10:03:00.000Z",
    });

    expect(result.status).toBe("pr_created");
    expect(result.filesChanged).toEqual(["src/server.ts"]);
    expect(client.committedFiles).toEqual(["src/server.ts"]);
    expect(client.calls).toContain(
      "createRef:refs/heads/autocyber/fix-restrict-cors-origins",
    );
    expect(client.committedBranches).not.toContain("main");
    expect(result.pullRequestUrl).toBe(
      "https://github.com/mshen0/autocyber-demo/pull/7",
    );
  });

  it("blocks verified executions that include files outside the approved proposal", async () => {
    const workingCopyPath = await createWorkingCopy();
    const client = createMockClient();

    const result = await createGitHubPrRemediation({
      proposal: approvedProposal,
      execution: {
        ...verifiedExecution,
        workingCopyPath,
        filesChanged: ["src/server.ts", "README.md"],
      },
      target: createTarget(),
      client,
    });

    expect(result.status).toBe("blocked");
    expect(result.error).toBe(
      "Verified remediation included files outside the approved proposal.",
    );
    expect(client.calls).toEqual([]);
  });

  it("handles GitHub API errors safely", async () => {
    const workingCopyPath = await createWorkingCopy();
    const client = createMockClient({ failOnCreatePullRequest: true });

    const result = await createGitHubPrRemediation({
      proposal: approvedProposal,
      execution: { ...verifiedExecution, workingCopyPath },
      target: createTarget(),
      client,
    });

    expect(result.status).toBe("failed");
    expect(result.pullRequestUrl).toBeNull();
    expect(result.error).toBe("GitHub PR creation failed.");
  });
});

function createTarget() {
  return {
    owner: "mshen0",
    repo: "autocyber-demo",
    defaultBranch: "main",
    tokenMode: "token" as const,
    repoUrl: "https://github.com/mshen0/autocyber-demo",
  };
}

async function createWorkingCopy(): Promise<string> {
  const workingCopyPath = await mkdtemp(
    join(tmpdir(), "autocyber-stage4b-test-"),
  );
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(join(workingCopyPath, "src"), { recursive: true }),
  );
  await writeFile(
    join(workingCopyPath, "src/server.ts"),
    "app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));\n",
  );
  await writeFile(join(workingCopyPath, "README.md"), "unrelated\n");
  return workingCopyPath;
}

function createMockClient(
  options: { failOnCreatePullRequest?: boolean } = {},
): GitHubRemediationClient & {
  calls: string[];
  committedFiles: string[];
  committedBranches: string[];
} {
  const calls: string[] = [];
  const committedFiles: string[] = [];
  const committedBranches: string[] = [];

  return {
    calls,
    committedFiles,
    committedBranches,
    async getBranchHead() {
      calls.push("getBranchHead:main");
      return { sha: "base-sha" };
    },
    async createBranch({ ref }) {
      calls.push(`createRef:${ref}`);
    },
    async commitFiles({ branch, files }) {
      calls.push(`commitFiles:${branch}`);
      committedBranches.push(branch);
      committedFiles.push(...files.map((file) => file.path));
      await readFile(join(tmpdir(), "missing-file"), "utf8").catch(
        () => undefined,
      );
      return { commitSha: "commit-sha" };
    },
    async createPullRequest() {
      calls.push("createPullRequest");
      if (options.failOnCreatePullRequest) {
        throw new Error(
          fakeGitHubToken("example_secret_token_should_not_leak"),
        );
      }
      return {
        url: "https://github.com/mshen0/autocyber-demo/pull/7",
        number: 7,
      };
    },
  };
}

function fakeGitHubToken(label: string): string {
  return ["ghp", label].join("_");
}
