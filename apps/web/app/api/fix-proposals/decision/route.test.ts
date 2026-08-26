import { beforeEach, describe, expect, it } from "vitest";
import type { FixProposal } from "@autocyber/core";
import { getPersistenceStore } from "../../../../lib/persistence/store";
import { POST } from "./route";

describe("fix proposal decision API route", () => {
  beforeEach(() => {
    process.env.AUTOCYBER_PERSISTENCE = "dev";
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("records accepted fix decisions with audit logs", async () => {
    const proposal = createProposal({ status: "draft" });

    const response = await POST(
      new Request("http://localhost/api/fix-proposals/decision", {
        method: "POST",
        body: JSON.stringify({
          proposal,
          decisionType: "fix_accepted",
          note: "Use this auth guard again.",
        }),
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(200);
    expect(body.proposal).toMatchObject({
      id: proposal.id,
      status: "approved",
    });
    expect(snapshot.fixDecisionMemories).toEqual([
      expect.objectContaining({
        repositoryId: proposal.repositoryId,
        findingFingerprint: proposal.findingFingerprint,
        decisionType: "fix_accepted",
        proposalId: proposal.id,
        rationale: "Use this auth guard again.",
      }),
    ]);
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "fix_decision_memory_recorded",
    );
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "proposal_approved",
    );
  });

  it("records rejected fix decisions with optional rationale", async () => {
    const proposal = createProposal({ status: "draft" });

    const response = await POST(
      new Request("http://localhost/api/fix-proposals/decision", {
        method: "POST",
        body: JSON.stringify({
          proposal,
          decisionType: "fix_rejected",
          note: "We prefer middleware.",
        }),
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(200);
    expect(body.proposal).toMatchObject({
      id: proposal.id,
      status: "rejected",
    });
    expect(snapshot.fixDecisionMemories[0]).toMatchObject({
      decisionType: "fix_rejected",
      rationale: "We prefer middleware.",
    });
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "proposal_rejected",
    );
  });

  it("persists advisory acknowledgement and manual-fix preference decisions", async () => {
    const advisory = createProposal({ id: "fix_advisory", kind: "advisory" });

    const ackResponse = await POST(
      new Request("http://localhost/api/fix-proposals/decision", {
        method: "POST",
        body: JSON.stringify({
          proposal: advisory,
          decisionType: "advisory_acknowledged",
          note: "Tracking manually.",
        }),
      }),
    );
    const manualResponse = await POST(
      new Request("http://localhost/api/fix-proposals/decision", {
        method: "POST",
        body: JSON.stringify({
          proposal: advisory,
          decisionType: "manual_fix_preferred",
        }),
      }),
    );

    expect(ackResponse.status).toBe(200);
    expect(manualResponse.status).toBe(200);
    expect(
      getPersistenceStore()
        .snapshot()
        .fixDecisionMemories.map((memory) => memory.decisionType),
    ).toEqual(["advisory_acknowledged", "manual_fix_preferred"]);
  });

  it("rejects invalid decision types without leaking proposal contents", async () => {
    const response = await POST(
      new Request("http://localhost/api/fix-proposals/decision", {
        method: "POST",
        body: JSON.stringify({
          proposal: createProposal(),
          decisionType: "delete_everything",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid decision input");
    expect(JSON.stringify(body)).not.toContain("await auth");
  });
});

function createProposal(overrides: Partial<FixProposal> = {}): FixProposal {
  return {
    id: "fix_decision",
    findingId: "finding_decision",
    repositoryId: "repo_decision",
    findingFingerprint: "fp_decision",
    status: "draft",
    kind: "patch",
    title: "Fix auth route",
    explanation: "Add auth.",
    proposedPatch: "Require auth.",
    diff: "--- a/app/api/user/route.ts\n+++ b/app/api/user/route.ts\n@@\n-export async function GET() {\n+export async function GET() {\n+  await auth();",
    risk: "Low.",
    verificationPlan: ["Rerun scanner."],
    filesChanged: ["app/api/user/route.ts"],
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}
