import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import type { FixProposal } from "@autocyber/core";
import type { LocalRemediationExecution } from "@autocyber/remediation";
import { getPersistenceStore } from "../../../lib/persistence/store";

const proposal: FixProposal = {
  id: "fix_headers",
  findingId: "finding_headers",
  repositoryId: "repo_demo",
  status: "approved",
  kind: "patch",
  title: "Add baseline security headers in next.config.js",
  explanation: "Add standard browser hardening headers.",
  proposedPatch: "Add a headers export to the Next.js config.",
  diff: `--- a/next.config.js
+++ b/next.config.js
@@
-const nextConfig = {};
+const nextConfig = { headers: async () => [] };`,
  risk: "Low.",
  verificationPlan: ["Rerun the missing-security-headers scanner rule."],
  filesChanged: ["next.config.js"],
  createdAt: "2026-05-29T10:00:00.000Z",
  updatedAt: "2026-05-29T10:00:00.000Z"
};

const execution: LocalRemediationExecution = {
  id: "rem_fix_headers",
  fixProposalId: "fix_headers",
  repositoryId: "repo_demo",
  status: "verified",
  workingCopyPath: "/tmp/autocyber-remediation-test",
  filesChanged: ["next.config.js"],
  verificationResult: {
    status: "passed",
    checksRun: [{ name: "scanner-rule", status: "passed", outputSummary: "missing-security-headers no longer appears." }],
    outputSummary: "scanner-rule passed",
    limitations: []
  },
  error: null,
  createdAt: "2026-05-29T10:01:00.000Z",
  updatedAt: "2026-05-29T10:02:00.000Z"
};

describe("GitHub PR API route", () => {
  beforeEach(() => {
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("returns a safe error when the GitHub token is not configured", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    const originalFineGrainedToken = process.env.GITHUB_FINE_GRAINED_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_FINE_GRAINED_TOKEN;

    const response = await POST(
      new Request("http://localhost/api/github-prs", {
        method: "POST",
        body: JSON.stringify({
          proposal,
          execution,
          target: {
            owner: "programmingishardlol",
            repo: "autocyber-stage4-test",
            defaultBranch: "main",
            tokenMode: "token"
          }
        })
      })
    );
    const body = await response.json();

    process.env.GITHUB_TOKEN = originalToken;
    process.env.GITHUB_FINE_GRAINED_TOKEN = originalFineGrainedToken;

    expect(response.status).toBe(400);
    expect(body.error).toBe("GitHub token not configured");
    expect(JSON.stringify(body)).not.toContain("github_pat_");
  });

  it("returns a safe error for invalid repository targets", async () => {
    const response = await POST(
      new Request("http://localhost/api/github-prs", {
        method: "POST",
        body: JSON.stringify({
          proposal,
          execution,
          target: {
            owner: "programmingishardlol",
            defaultBranch: "main",
            tokenMode: "token"
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid GitHub repository target");
    expect(JSON.stringify(body)).not.toContain("Error:");
  });

  it("blocks direct advisory PR requests before token access or GitHub writes", async () => {
    const response = await POST(
      new Request("http://localhost/api/github-prs", {
        method: "POST",
        body: JSON.stringify({
          proposal: { ...proposal, kind: "advisory", proposedPatch: "Manual remediation required: review the route architecture." },
          execution,
          target: {
            owner: "programmingishardlol",
            repo: "autocyber-stage4-test",
            defaultBranch: "main",
            tokenMode: "token"
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("GitHub PR blocked");
    expect(body.message).toBe("This is an advisory-only proposal and cannot be automatically remediated.");
    expect(JSON.stringify(body)).not.toContain("const nextConfig");
  });

  it("blocks direct PR requests without applyable unified diffs", async () => {
    const response = await POST(
      new Request("http://localhost/api/github-prs", {
        method: "POST",
        body: JSON.stringify({
          proposal: { ...proposal, diff: "Review this route manually." },
          execution,
          target: {
            owner: "programmingishardlol",
            repo: "autocyber-stage4-test",
            defaultBranch: "main",
            tokenMode: "token"
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("GitHub PR blocked");
    expect(body.message).toBe("Fix proposal does not contain an applyable unified diff.");
  });

  it("blocks direct rejected PR requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/github-prs", {
        method: "POST",
        body: JSON.stringify({
          proposal: { ...proposal, status: "rejected" },
          execution,
          target: {
            owner: "programmingishardlol",
            repo: "autocyber-stage4-test",
            defaultBranch: "main",
            tokenMode: "token"
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("GitHub PR blocked");
    expect(body.message).toBe("Fix proposal must be approved before creating a GitHub PR.");
  });

  it("does not allow direct API requests to override failed local verification", async () => {
    const response = await POST(
      new Request("http://localhost/api/github-prs", {
        method: "POST",
        body: JSON.stringify({
          proposal,
          execution: { ...execution, status: "failed", verificationResult: { ...execution.verificationResult!, status: "failed" } },
          target: {
            owner: "programmingishardlol",
            repo: "autocyber-stage4-test",
            defaultBranch: "main",
            tokenMode: "token"
          },
          allowFailedVerification: true
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("GitHub PR blocked");
    expect(body.message).toBe("Local verification must pass before creating a GitHub PR.");
  });

  it("blocks public GitHub repository PR creation until write access is connected", async () => {
    await getPersistenceStore().upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "example",
      name: "public-app",
      defaultBranch: "main",
      url: "https://github.com/example/public-app",
      connectionType: "public_github",
      canScan: true,
      canMonitor: false,
      canOpenPr: false,
      isPrivate: false
    });

    const response = await POST(
      new Request("http://localhost/api/github-prs", {
        method: "POST",
        body: JSON.stringify({
          proposal: { ...proposal, repositoryId: "repo_public" },
          execution: { ...execution, repositoryId: "repo_public" },
          target: {
            owner: "example",
            repo: "public-app",
            defaultBranch: "main",
            tokenMode: "token"
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("GitHub connection required");
    expect(body.message).toBe("Connect GitHub with PR permissions before AutoCyber can open a remediation PR.");
    expect(JSON.stringify(body)).not.toContain("github_pat_");
  });
});
