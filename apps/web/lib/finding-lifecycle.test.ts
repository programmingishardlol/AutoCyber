import { describe, expect, it } from "vitest";
import type { Finding } from "@autocyber/core";
import type { NormalizedFinding } from "@autocyber/scanner";
import {
  classifyFindingLifecycle,
  createFindingFingerprint,
  summarizeFindingLifecycle,
} from "./finding-lifecycle";

describe("Stage 7A finding lifecycle", () => {
  it("generates stable repository-scoped fingerprints without scan ids", () => {
    const first = createNormalizedFinding({
      repositoryId: "repo_a",
      scanJobId: "scan_first",
      evidenceSnippet: "  auth() missing near handler  ",
    });
    const second = createNormalizedFinding({
      repositoryId: "repo_a",
      scanJobId: "scan_second",
      evidenceSnippet: "auth() missing near handler",
    });
    const otherRepository = createNormalizedFinding({
      repositoryId: "repo_b",
      scanJobId: "scan_first",
      evidenceSnippet: "auth() missing near handler",
    });

    expect(createFindingFingerprint(first)).toBe(
      createFindingFingerprint(second),
    );
    expect(createFindingFingerprint(first)).not.toContain("scan_first");
    expect(createFindingFingerprint(first)).not.toBe(
      createFindingFingerprint(otherRepository),
    );
  });

  it("classifies same open finding across two scans as existing", () => {
    const previous = createPersistedFinding({
      id: "finding_previous",
      repositoryId: "repo_a",
      scanJobId: "scan_previous",
      lifecycleStatus: "new",
      fingerprint: "fp_auth",
    });
    const current = createNormalizedFinding({
      id: "finding_current",
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      fingerprint: "fp_auth",
    });

    const result = classifyFindingLifecycle({
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      currentFindings: [current],
      previousFindings: [previous],
      falsePositiveFingerprints: new Set(),
    });

    expect(result.currentFindings[0]).toMatchObject({
      lifecycleStatus: "existing",
      firstSeenAt: previous.firstSeenAt,
      occurrenceCount: 2,
      previousFindingId: previous.id,
    });
    expect(result.resolvedFindings).toHaveLength(0);
  });

  it("marks previous open findings missing from the next scan as resolved", () => {
    const previous = createPersistedFinding({
      id: "finding_missing",
      repositoryId: "repo_a",
      scanJobId: "scan_previous",
      lifecycleStatus: "existing",
      fingerprint: "fp_missing",
    });

    const result = classifyFindingLifecycle({
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      currentFindings: [],
      previousFindings: [previous],
      falsePositiveFingerprints: new Set(),
    });

    expect(result.resolvedFindings).toEqual([
      expect.objectContaining({
        id: "finding_missing:resolved:scan_current",
        repositoryId: "repo_a",
        scanJobId: "scan_current",
        lifecycleStatus: "resolved",
        status: "resolved",
        fingerprint: "fp_missing",
        occurrenceCount: 1,
        previousFindingId: "finding_missing",
      }),
    ]);
  });

  it("does not create duplicate resolved rows after a fingerprint is already resolved", () => {
    const open = createPersistedFinding({
      id: "finding_open",
      repositoryId: "repo_a",
      scanJobId: "scan_first",
      lifecycleStatus: "new",
      fingerprint: "fp_already_resolved",
      updatedAt: "2026-06-12T10:00:00.000Z",
    });
    const resolved = createPersistedFinding({
      id: "finding_open:resolved:scan_second",
      repositoryId: "repo_a",
      scanJobId: "scan_second",
      lifecycleStatus: "resolved",
      status: "resolved",
      fingerprint: "fp_already_resolved",
      previousFindingId: "finding_open",
      updatedAt: "2026-06-12T11:00:00.000Z",
    });

    const result = classifyFindingLifecycle({
      repositoryId: "repo_a",
      scanJobId: "scan_third",
      currentFindings: [],
      previousFindings: [open, resolved],
      falsePositiveFingerprints: new Set(),
    });

    expect(result.resolvedFindings).toHaveLength(0);
  });

  it("classifies resolved findings that appear again as reappeared", () => {
    const resolved = createPersistedFinding({
      id: "finding_resolved",
      repositoryId: "repo_a",
      scanJobId: "scan_previous",
      lifecycleStatus: "resolved",
      status: "resolved",
      fingerprint: "fp_reappeared",
      occurrenceCount: 2,
    });
    const current = createNormalizedFinding({
      id: "finding_current",
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      fingerprint: "fp_reappeared",
    });

    const result = classifyFindingLifecycle({
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      currentFindings: [current],
      previousFindings: [resolved],
      falsePositiveFingerprints: new Set(),
    });

    expect(result.currentFindings[0]).toMatchObject({
      lifecycleStatus: "reappeared",
      occurrenceCount: 3,
      previousFindingId: "finding_resolved",
    });
  });

  it("classifies a recurrence as reappeared when an older open row and newer resolved row both exist", () => {
    const open = createPersistedFinding({
      id: "finding_open",
      repositoryId: "repo_a",
      scanJobId: "scan_first",
      lifecycleStatus: "new",
      fingerprint: "fp_reappeared_with_history",
      occurrenceCount: 2,
      updatedAt: "2026-06-12T10:00:00.000Z",
    });
    const resolved = createPersistedFinding({
      id: "finding_open:resolved:scan_second",
      repositoryId: "repo_a",
      scanJobId: "scan_second",
      lifecycleStatus: "resolved",
      status: "resolved",
      fingerprint: "fp_reappeared_with_history",
      occurrenceCount: 2,
      previousFindingId: "finding_open",
      resolvedAt: "2026-06-12T11:00:00.000Z",
      updatedAt: "2026-06-12T11:00:00.000Z",
    });
    const current = createNormalizedFinding({
      id: "finding_current",
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      fingerprint: "fp_reappeared_with_history",
    });

    const result = classifyFindingLifecycle({
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      currentFindings: [current],
      previousFindings: [open, resolved],
      falsePositiveFingerprints: new Set(),
    });

    expect(result.currentFindings[0]).toMatchObject({
      lifecycleStatus: "reappeared",
      occurrenceCount: 3,
      previousFindingId: resolved.id,
    });
  });

  it("keeps lifecycle comparison scoped to the current repository", () => {
    const otherRepoPrevious = createPersistedFinding({
      id: "finding_other_repo",
      repositoryId: "repo_b",
      scanJobId: "scan_previous",
      lifecycleStatus: "new",
      fingerprint: "fp_shared",
    });
    const current = createNormalizedFinding({
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      fingerprint: "fp_shared",
    });

    const result = classifyFindingLifecycle({
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      currentFindings: [current],
      previousFindings: [otherRepoPrevious],
      falsePositiveFingerprints: new Set(),
    });

    expect(result.currentFindings[0]?.lifecycleStatus).toBe("new");
    expect(result.resolvedFindings).toHaveLength(0);
  });

  it("marks matching future findings with false positive memory", () => {
    const current = createNormalizedFinding({
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      fingerprint: "fp_false_positive",
    });

    const result = classifyFindingLifecycle({
      repositoryId: "repo_a",
      scanJobId: "scan_current",
      currentFindings: [current],
      previousFindings: [],
      falsePositiveFingerprints: new Set(["fp_false_positive"]),
    });

    expect(result.currentFindings[0]).toMatchObject({
      fingerprint: "fp_false_positive",
      status: "false_positive",
      memoryStatus: "false_positive_suppressed",
    });
  });

  it("summarizes lifecycle counts for scan history", () => {
    const summary = summarizeFindingLifecycle([
      createPersistedFinding({ id: "new", lifecycleStatus: "new" }),
      createPersistedFinding({ id: "existing", lifecycleStatus: "existing" }),
      createPersistedFinding({
        id: "resolved",
        lifecycleStatus: "resolved",
        status: "resolved",
      }),
      createPersistedFinding({
        id: "reappeared",
        lifecycleStatus: "reappeared",
      }),
    ]);

    expect(summary).toEqual({
      new: 1,
      existing: 1,
      resolved: 1,
      reappeared: 1,
    });
  });
});

function createNormalizedFinding(
  overrides: Partial<NormalizedFinding> & {
    fingerprint?: string;
    evidenceSnippet?: string;
  },
): NormalizedFinding {
  return {
    id:
      overrides.id ??
      `${overrides.scanJobId ?? "scan_test"}:local:missing-api-auth:abcd`,
    repositoryId: overrides.repositoryId ?? "repo_a",
    scanJobId: overrides.scanJobId ?? "scan_test",
    ruleId: "missing-api-auth",
    title: "API route missing authentication",
    category: "access-control",
    severity: "high",
    confidence: 0.9,
    status: "open",
    stackTags: ["nextjs"],
    affectedFile: "app/api/admin/users/route.ts",
    evidence: [
      {
        filePath: "app/api/admin/users/route.ts",
        startLine: 12,
        endLine: 12,
        snippet:
          overrides.evidenceSnippet ??
          "export async function GET() { return Response.json(users); }",
      },
    ],
    riskExplanation:
      "The route can expose user data without checking the caller.",
    remediationSummary:
      "Require authentication and authorization before returning data.",
    verificationStrategy: "Rerun the scanner.",
    autofixAvailable: true,
    ...overrides,
  };
}

function createPersistedFinding(overrides: Partial<Finding>): Finding {
  const now = "2026-06-12T10:00:00.000Z";
  return {
    ...createNormalizedFinding({
      id: overrides.id,
      repositoryId: overrides.repositoryId,
      scanJobId: overrides.scanJobId,
      fingerprint: overrides.fingerprint,
    }),
    lifecycleStatus: "new",
    firstSeenAt: now,
    lastSeenAt: now,
    resolvedAt: null,
    occurrenceCount: 1,
    fingerprint: overrides.fingerprint ?? "fp_default",
    previousFindingId: null,
    memoryStatus: "none",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
