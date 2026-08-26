import { describe, expect, it } from "vitest";
import type { FixDecisionMemory } from "@autocyber/core";
import type { NormalizedFinding } from "@autocyber/scanner";
import {
  rankFindingsByPriority,
  scoreFindingPriority,
  scoreProposalPriority,
} from "./priority-scoring";

describe("Stage 7C priority scoring", () => {
  it("ranks new high-severity public API findings above existing medium findings", () => {
    const newAuthFinding = createFinding({
      id: "finding_new_auth",
      severity: "high",
      confidence: 0.94,
      lifecycleStatus: "new",
      ruleId: "missing-api-auth",
      affectedFile: "app/api/user/route.ts",
    });
    const existingMediumFinding = createFinding({
      id: "finding_existing_medium",
      severity: "medium",
      confidence: 0.95,
      lifecycleStatus: "existing",
      ruleId: "missing-env-example",
      affectedFile: ".env.example",
    });

    const ranked = rankFindingsByPriority([
      existingMediumFinding,
      newAuthFinding,
    ]);

    expect(ranked[0]?.finding.id).toBe("finding_new_auth");
    expect(ranked[0]?.priority.priorityScore).toBeGreaterThan(
      ranked[1]!.priority.priorityScore,
    );
    expect(ranked[0]?.priority.priorityBand).toBe("critical_action");
    expect(ranked[0]?.priority.priorityReasons).toEqual(
      expect.arrayContaining([
        "New in latest scan",
        "Public API route involved",
      ]),
    );
  });

  it("ranks reappeared high-severity findings high and resolved findings as non-active risk", () => {
    const reappeared = scoreFindingPriority(
      createFinding({
        severity: "high",
        lifecycleStatus: "reappeared",
        ruleId: "stripe-webhook-missing-construct-event",
        affectedFile: "app/api/stripe/webhook/route.ts",
      }),
    );
    const resolved = scoreFindingPriority(
      createFinding({
        severity: "critical",
        lifecycleStatus: "resolved",
        resolvedAt: "2026-06-16T01:00:00.000Z",
      }),
    );

    expect(reappeared.priorityBand).toBe("critical_action");
    expect(reappeared.priorityReasons).toEqual(
      expect.arrayContaining([
        "Reappeared after being resolved",
        "Stripe webhook verification issue",
      ]),
    );
    expect(resolved).toMatchObject({
      priorityScore: 0,
      priorityBand: "resolved",
      priorityReasons: ["Resolved finding is not active risk"],
    });
  });

  it("suppresses false-positive memory and adds decision-memory context", () => {
    const finding = createFinding({
      severity: "high",
      lifecycleStatus: "new",
      memoryStatus: "false_positive_suppressed",
      ruleId: "missing-api-auth",
      affectedFile: "app/api/health/route.ts",
    });

    const priority = scoreFindingPriority(finding, {
      decisionMemory: {
        previouslyAccepted: true,
        previouslyRejected: false,
        manualFixPreferred: false,
        falsePositiveMemory: true,
        samePatchPreviouslyRejected: false,
        latestDecisionType: "false_positive",
        latestDecisionAt: "2026-06-16T00:00:00.000Z",
        latestRationale: "Health check route is intentionally public.",
      },
    });

    expect(priority.priorityBand).toBe("monitor");
    expect(priority.priorityScore).toBeLessThan(25);
    expect(priority.priorityReasons).toEqual(
      expect.arrayContaining([
        "False positive memory suppresses noisy recommendations",
      ]),
    );
    expect(priority.priorityReasons).not.toContain(
      "Previously accepted fix pattern available",
    );
  });

  it("uses accepted, rejected, and manual decision memory when scoring proposals", () => {
    const finding = createFinding({
      severity: "high",
      lifecycleStatus: "new",
      ruleId: "ai-unsafe-prompt-logging",
      affectedFile: "app/api/ai/route.ts",
    });
    const acceptedProposal = scoreProposalPriority(
      {
        id: "fix_ai",
        findingId: finding.id,
        repositoryId: finding.repositoryId,
        findingFingerprint: finding.fingerprint,
        ruleId: finding.ruleId,
        status: "draft",
        kind: "patch",
        title: "Stop logging raw prompts",
        explanation: "Redact prompt logs.",
        proposedPatch: "Remove raw prompt logging.",
        diff: "--- a/app/api/ai/route.ts\n+++ b/app/api/ai/route.ts",
        risk: "Low.",
        verificationPlan: ["Rerun scanner."],
        filesChanged: ["app/api/ai/route.ts"],
        createdAt: "2026-06-16T00:00:00.000Z",
        updatedAt: "2026-06-16T00:00:00.000Z",
      },
      finding,
      {
        decisionMemory: {
          previouslyAccepted: true,
          previouslyRejected: false,
          manualFixPreferred: false,
          falsePositiveMemory: false,
          samePatchPreviouslyRejected: false,
          latestDecisionType: "fix_accepted",
          latestDecisionAt: "2026-06-16T00:00:00.000Z",
          latestRationale: null,
        },
      },
    );
    const rejectedManualProposal = scoreProposalPriority(
      {
        ...acceptedProposal.proposal,
        id: "fix_ai_rejected",
        kind: "advisory",
        decisionMemory: {
          previouslyAccepted: false,
          previouslyRejected: true,
          manualFixPreferred: true,
          falsePositiveMemory: false,
          samePatchPreviouslyRejected: true,
          latestDecisionType: "manual_fix_preferred",
          latestDecisionAt: "2026-06-16T00:05:00.000Z",
          latestRationale: "Needs product-specific logging policy.",
        },
      },
      finding,
    );

    expect(acceptedProposal.priority.priorityReasons).toEqual(
      expect.arrayContaining([
        "Previously accepted fix pattern available",
        "Patch proposal is directly actionable",
      ]),
    );
    expect(acceptedProposal.priority.priorityScore).toBeGreaterThan(
      rejectedManualProposal.priority.priorityScore,
    );
    expect(rejectedManualProposal.priority.priorityReasons).toEqual(
      expect.arrayContaining([
        "Similar fix was previously rejected",
        "Manual fix preferred",
      ]),
    );
  });

  it("keeps decision memory repository-scoped when ranking findings", () => {
    const repoAFinding = createFinding({
      id: "finding_repo_a",
      repositoryId: "repo_a",
      fingerprint: "fp_same",
      ruleId: "missing-api-auth",
    });
    const repoBFinding = createFinding({
      id: "finding_repo_b",
      repositoryId: "repo_b",
      fingerprint: "fp_same",
      ruleId: "missing-api-auth",
    });
    const memories: FixDecisionMemory[] = [
      createMemory({
        repositoryId: "repo_a",
        findingFingerprint: "fp_same",
        ruleId: "missing-api-auth",
        decisionType: "fix_accepted",
      }),
    ];

    const ranked = rankFindingsByPriority([repoBFinding, repoAFinding], {
      decisionMemories: memories,
    });

    expect(
      ranked.find((item) => item.finding.id === "finding_repo_a")?.priority
        .priorityReasons,
    ).toContain("Previously accepted fix pattern available");
    expect(
      ranked.find((item) => item.finding.id === "finding_repo_b")?.priority
        .priorityReasons,
    ).not.toContain("Previously accepted fix pattern available");
  });
});

function createFinding(
  overrides: Partial<NormalizedFinding> = {},
): NormalizedFinding {
  return {
    id: "finding_base",
    repositoryId: "repo_priority",
    scanJobId: "scan_priority",
    ruleId: "missing-api-auth",
    title: "API route does not enforce authentication",
    category: "missing-auth",
    severity: "high",
    confidence: 0.9,
    status: "open",
    lifecycleStatus: "new",
    firstSeenAt: "2026-06-16T00:00:00.000Z",
    lastSeenAt: "2026-06-16T00:00:00.000Z",
    resolvedAt: null,
    occurrenceCount: 1,
    fingerprint: "fp_priority",
    previousFindingId: null,
    memoryStatus: "none",
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
    ...overrides,
  };
}

function createMemory(
  overrides: Partial<FixDecisionMemory>,
): FixDecisionMemory {
  return {
    id: "fixmem_priority",
    teamId: "team_dev",
    repositoryId: "repo_priority",
    findingFingerprint: "fp_priority",
    ruleId: "missing-api-auth",
    decisionType: "fix_accepted",
    proposalId: null,
    findingId: null,
    rationale: null,
    patchHash: null,
    recommendedFixHash: null,
    proposalKind: null,
    actorUserId: null,
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    ...overrides,
  };
}
