import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FixProposal } from "@autocyber/core";
import { getPersistenceStore } from "../../../lib/persistence/store";
import { POST } from "./route";

const proposal: FixProposal = {
  id: "fix_advisory",
  findingId: "finding_ai_rate_limit",
  repositoryId: "repo_demo",
  status: "approved",
  kind: "advisory",
  title: "Add rate limiting to AI route",
  explanation: "Manual architecture review is required.",
  proposedPatch:
    "Manual remediation required: add authenticated user or IP-based rate limits.",
  diff: `--- a/app/api/chat/route.ts
+++ b/app/api/chat/route.ts
@@
-const response = await openai.responses.create(input);
+const response = await limiter.run(() => openai.responses.create(input));`,
  risk: "Manual review required.",
  verificationPlan: ["Rerun the AI rate-limit scanner rule."],
  filesChanged: ["app/api/chat/route.ts"],
  createdAt: "2026-05-31T10:00:00.000Z",
  updatedAt: "2026-05-31T10:00:00.000Z",
};

describe("local remediation API route", () => {
  it("blocks direct advisory remediation requests before filesystem work", async () => {
    const response = await POST(
      new Request("http://localhost/api/remediations", {
        method: "POST",
        body: JSON.stringify({
          proposal,
          repositoryPath: "/tmp",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("automatic remediation blocked");
    expect(body.message).toBe(
      "This is an advisory-only proposal and cannot be automatically remediated.",
    );
    expect(JSON.stringify(body)).not.toContain("openai.responses.create");
  });

  it.each(["draft", "rejected"] as const)(
    "blocks direct %s remediation requests",
    async (status) => {
      const response = await POST(
        new Request("http://localhost/api/remediations", {
          method: "POST",
          body: JSON.stringify({
            proposal: {
              ...proposal,
              kind: "patch",
              proposedPatch: "Apply a narrow patch.",
              status,
            },
            repositoryPath: "/tmp",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("automatic remediation blocked");
      expect(body.message).toBe(
        "Fix proposal must be approved before remediation can run.",
      );
    },
  );

  it("persists approved patch proposals before local remediation runs", async () => {
    process.env.AUTOCYBER_PERSISTENCE = "dev";
    globalThis.__autocyberPersistenceStore = undefined;
    const repositoryPath = mkdtempSync(
      join(tmpdir(), "autocyber-remediation-route-test-"),
    );

    try {
      const approvedProposal: FixProposal = {
        ...proposal,
        id: "fix_approved_patch",
        status: "approved",
        kind: "patch",
        proposedPatch: "Remove raw prompt logging.",
        diff: `--- a/app/api/chat/route.ts
+++ b/app/api/chat/route.ts
@@
-console.log("prompt", prompt);
+// Raw prompt logging removed.
`,
        filesChanged: ["app/api/chat/route.ts"],
      };

      const response = await POST(
        new Request("http://localhost/api/remediations", {
          method: "POST",
          body: JSON.stringify({
            proposal: approvedProposal,
            repositoryPath,
          }),
        }),
      );

      const snapshot = getPersistenceStore().snapshot();
      expect(response.status).toBe(400);
      expect(
        snapshot.fixProposals.find(
          (candidate) => candidate.id === approvedProposal.id,
        )?.status,
      ).toBe("approved");
      expect(snapshot.auditLogs.map((log) => log.action)).toContain(
        "proposal_approved",
      );
      expect(snapshot.securityMemories.map((memory) => memory.kind)).toContain(
        "accepted_fix",
      );
      expect(snapshot.fixDecisionMemories).toEqual([
        expect.objectContaining({
          repositoryId: approvedProposal.repositoryId,
          proposalId: approvedProposal.id,
          findingId: approvedProposal.findingId,
          decisionType: "fix_accepted",
        }),
      ]);
    } finally {
      rmSync(repositoryPath, { recursive: true, force: true });
      globalThis.__autocyberPersistenceStore = undefined;
      delete process.env.AUTOCYBER_PERSISTENCE;
    }
  });

  it("records remediation_applied memory when local remediation verifies successfully", async () => {
    process.env.AUTOCYBER_PERSISTENCE = "dev";
    globalThis.__autocyberPersistenceStore = undefined;
    const repositoryPath = mkdtempSync(
      join(tmpdir(), "autocyber-remediation-success-test-"),
    );

    try {
      mkdirSync(join(repositoryPath, "app/api/chat"), { recursive: true });
      writeFileSync(
        join(repositoryPath, "app/api/chat/route.ts"),
        "vulnerable\n",
      );

      const approvedProposal: FixProposal = {
        ...proposal,
        id: "fix_verified_patch",
        findingId: "finding_verified",
        findingFingerprint: "fp_verified",
        status: "approved",
        kind: "patch",
        proposedPatch: "Replace vulnerable marker.",
        diff: `--- a/app/api/chat/route.ts
+++ b/app/api/chat/route.ts
@@
-vulnerable
+safe
`,
        filesChanged: ["app/api/chat/route.ts"],
      };

      const response = await POST(
        new Request("http://localhost/api/remediations", {
          method: "POST",
          body: JSON.stringify({
            proposal: approvedProposal,
            repositoryPath,
          }),
        }),
      );
      const snapshot = getPersistenceStore().snapshot();

      expect(response.status).toBe(200);
      expect(
        snapshot.fixDecisionMemories.map((memory) => memory.decisionType),
      ).toContain("remediation_applied");
      expect(snapshot.auditLogs.map((log) => log.action)).toContain(
        "remediation_applied",
      );
    } finally {
      rmSync(repositoryPath, { recursive: true, force: true });
      globalThis.__autocyberPersistenceStore = undefined;
      delete process.env.AUTOCYBER_PERSISTENCE;
    }
  });
});
