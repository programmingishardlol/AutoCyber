import { beforeEach, describe, expect, it } from "vitest";
import type { FixProposal } from "@autocyber/core";
import { getPersistenceStore } from "../../../lib/persistence/store";
import { POST } from "./route";

describe("fix proposal API decision memory", () => {
  beforeEach(() => {
    process.env.AUTOCYBER_PERSISTENCE = "dev";
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("surfaces previously accepted fix memory during proposal generation", async () => {
    const store = getPersistenceStore();
    await store.recordFixDecisionMemory({
      repositoryId: "repo_memory",
      findingFingerprint: "fp_auth_memory",
      ruleId: "missing-api-auth",
      decisionType: "fix_accepted",
      proposal: createProposal({
        id: "fix_accepted_auth",
        findingFingerprint: "fp_auth_memory",
      }),
      rationale: "This pattern worked in the admin API.",
    });

    const response = await POST(
      new Request("http://localhost/api/fix-proposals", {
        method: "POST",
        body: JSON.stringify({
          finding: createFinding({
            fingerprint: "fp_auth_memory",
          }),
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.decisionMemory).toMatchObject({
      previouslyAccepted: true,
      latestDecisionType: "fix_accepted",
      latestRationale: "This pattern worked in the admin API.",
    });
    expect(body.proposal.explanation).toContain(
      "Previously accepted fix pattern available",
    );
    expect(body.proposal.priorityBand).toBe("critical_action");
    expect(body.proposal.priorityReasons).toEqual(
      expect.arrayContaining([
        "Previously accepted fix pattern available",
        "Patch proposal is directly actionable",
      ]),
    );
  });

  it("labels a regenerated proposal when the same patch hash was previously rejected", async () => {
    const finding = createFinding({ fingerprint: "fp_rejected_auth" });
    const firstResponse = await POST(
      new Request("http://localhost/api/fix-proposals", {
        method: "POST",
        body: JSON.stringify({ finding }),
      }),
    );
    const firstBody = await firstResponse.json();
    const rejectedProposal = firstBody.proposal as FixProposal;

    await getPersistenceStore().recordFixDecisionMemory({
      repositoryId: finding.repositoryId,
      findingFingerprint: finding.fingerprint,
      ruleId: finding.ruleId,
      decisionType: "fix_rejected",
      proposal: rejectedProposal,
      rationale: "This guard belongs in middleware.",
    });

    const secondResponse = await POST(
      new Request("http://localhost/api/fix-proposals", {
        method: "POST",
        body: JSON.stringify({ finding }),
      }),
    );
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondBody.proposal.decisionMemory).toMatchObject({
      previouslyRejected: true,
      samePatchPreviouslyRejected: true,
      latestDecisionType: "fix_rejected",
    });
    expect(secondBody.proposal.risk).toContain(
      "Similar fix was previously rejected",
    );
  });

  it("suppresses noisy patch proposals for false-positive memory unless explicitly requested", async () => {
    const store = getPersistenceStore();
    const finding = createFinding({ fingerprint: "fp_false_positive_memory" });
    await store.recordFixDecisionMemory({
      repositoryId: finding.repositoryId,
      findingFingerprint: finding.fingerprint,
      ruleId: finding.ruleId,
      decisionType: "false_positive",
      findingId: finding.id,
      rationale: "Health-check route is intentionally public.",
    });

    const response = await POST(
      new Request("http://localhost/api/fix-proposals", {
        method: "POST",
        body: JSON.stringify({ finding }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.kind).toBe("advisory");
    expect(body.proposal.title).toContain("False positive memory");
    expect(body.proposal.decisionMemory).toMatchObject({
      falsePositiveMemory: true,
      latestRationale: "Health-check route is intentionally public.",
    });
  });
});

function createFinding(
  overrides: Partial<ReturnType<typeof baseFinding>> & {
    fingerprint?: string;
  } = {},
) {
  return {
    ...baseFinding(),
    ...overrides,
  };
}

function baseFinding() {
  return {
    id: "finding_auth",
    repositoryId: "repo_memory",
    scanJobId: "scan_memory",
    ruleId: "missing-api-auth",
    title: "API route does not enforce authentication",
    category: "missing-auth",
    severity: "high",
    confidence: 0.9,
    status: "open",
    stackTags: ["nextjs"],
    affectedFile: "app/api/user/route.ts",
    evidence: [
      {
        filePath: "app/api/user/route.ts",
        startLine: 1,
        endLine: 1,
        snippet: "export async function GET() { return Response.json(users); }",
      },
    ],
    riskExplanation: "The route can expose data without checking the caller.",
    remediationSummary: "Require authentication before returning data.",
    verificationStrategy: "Rerun scanner.",
    autofixAvailable: true,
    fingerprint: "fp_auth_memory",
  };
}

function createProposal(overrides: Partial<FixProposal> = {}): FixProposal {
  return {
    id: "fix_memory",
    findingId: "finding_auth",
    repositoryId: "repo_memory",
    findingFingerprint: "fp_auth_memory",
    status: "approved",
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
