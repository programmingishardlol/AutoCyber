import { describe, expect, it } from "vitest";
import type {
  Finding,
  FixDecisionMemory,
  Repository,
  ScanJob,
  VerificationResult,
} from "@autocyber/core";
import { generateEvidencePack } from "./evidence-pack";

describe("Stage 7C evidence packs", () => {
  it("summarizes lifecycle counts, top risks, decision memory, remediations, and next actions", () => {
    const pack = generateEvidencePack({
      repository: createRepository(),
      scanJob: createScanJob(),
      findings: [
        createFinding({
          id: "finding_auth",
          title: "API route does not enforce authentication",
          ruleId: "missing-api-auth",
          severity: "high",
          lifecycleStatus: "new",
          affectedFile: "app/api/user/route.ts",
        }),
        createFinding({
          id: "finding_existing",
          title: "Missing env example",
          ruleId: "missing-env-example",
          severity: "medium",
          lifecycleStatus: "existing",
          affectedFile: ".env.example",
        }),
        createFinding({
          id: "finding_resolved",
          title: "Security headers were restored",
          ruleId: "missing-security-headers",
          lifecycleStatus: "resolved",
          status: "resolved",
          resolvedAt: "2026-06-16T01:00:00.000Z",
        }),
        createFinding({
          id: "finding_fp",
          title: "Health route intentionally public",
          memoryStatus: "false_positive_suppressed",
          status: "false_positive",
          lifecycleStatus: "existing",
        }),
      ],
      decisionMemories: [
        createMemory({
          decisionType: "fix_accepted",
          ruleId: "missing-api-auth",
          findingFingerprint: "fp_auth",
        }),
        createMemory({
          decisionType: "fix_rejected",
          ruleId: "missing-security-headers",
          findingFingerprint: "fp_headers",
        }),
        createMemory({
          decisionType: "manual_fix_preferred",
          ruleId: "missing-env-example",
          findingFingerprint: "fp_env",
        }),
        createMemory({
          decisionType: "remediation_applied",
          ruleId: "ai-unsafe-prompt-logging",
          findingFingerprint: "fp_ai",
        }),
      ],
      verificationResults: [createVerificationResult()],
    });

    expect(pack.summary).toMatchObject({
      totalFindings: 4,
      newFindings: 1,
      existingFindings: 2,
      resolvedFindings: 1,
      reappearedFindings: 0,
      falsePositiveSuppressedFindings: 1,
    });
    expect(pack.topActiveRisks[0]?.title).toBe(
      "API route does not enforce authentication",
    );
    expect(pack.markdown).toContain("# AutoCyber Security Review Summary");
    expect(pack.markdown).toContain("Repository: acme/stage7c-app");
    expect(pack.markdown).toContain("Scan: scan_stage7c");
    expect(pack.markdown).toContain("Source: Push webhook");
    expect(pack.markdown).toContain("New findings: 1");
    expect(pack.markdown).toContain("False-positive-suppressed findings: 1");
    expect(pack.markdown).toContain("Accepted fix history: 1");
    expect(pack.markdown).toContain("Rejected/manual decision history: 2");
    expect(pack.markdown).toContain("Remediations applied: 1");
    expect(pack.markdown).toContain("Verification: 1 passed");
    expect(pack.markdown).toContain("Next recommended actions");
  });

  it("redacts secrets and private local paths from shareable evidence markdown", () => {
    const pack = generateEvidencePack({
      repository: {
        ...createRepository(),
        provider: "local",
        owner: "local",
        name: "stage7c-secret-app",
        url: "/private/tmp/autocyber-secret-app",
      },
      scanJob: createScanJob(),
      findings: [
        createFinding({
          title: "Potential secret committed to repository",
          ruleId: "exposed-secret",
          category: "secrets",
          severity: "critical",
          affectedFile: "/private/tmp/autocyber-secret-app/.env",
          evidence: [
            {
              filePath: "/private/tmp/autocyber-secret-app/.env",
              startLine: 1,
              endLine: 1,
              snippet:
                "DATABASE_URL=postgres://user:password@db.example.com:5432/app\nOPENAI_API_KEY=sk-testsecretvalue1234567890\nGITHUB_TOKEN=ghp_testsecretvalue1234567890",
            },
          ],
          riskExplanation:
            "Leaked private key -----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY----- can be abused.",
        }),
      ],
      decisionMemories: [
        createMemory({
          decisionType: "fix_rejected",
          rationale:
            "Do not mention ghp_testsecretvalue1234567890 or postgres://user:password@db.example.com:5432/app.",
        }),
      ],
      verificationResults: [],
    });

    expect(pack.markdown).not.toContain("/private/tmp");
    expect(pack.markdown).not.toContain("postgres://");
    expect(pack.markdown).not.toContain("sk-testsecretvalue1234567890");
    expect(pack.markdown).not.toContain("ghp_testsecretvalue1234567890");
    expect(pack.markdown).not.toContain("-----BEGIN PRIVATE KEY-----");
  });
});

function createRepository(): Repository {
  return {
    id: "repo_stage7c",
    projectId: "proj_dev",
    provider: "github",
    owner: "acme",
    name: "stage7c-app",
    defaultBranch: "main",
    url: "https://github.com/acme/stage7c-app",
    installationId: "123",
    isPrivate: true,
    connectionType: "github_app",
    canScan: true,
    canMonitor: true,
    canOpenPr: false,
    permissionsSummary: {},
    lastScannedAt: "2026-06-16T01:00:00.000Z",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T01:00:00.000Z",
  };
}

function createScanJob(): ScanJob {
  return {
    id: "scan_stage7c",
    repositoryId: "repo_stage7c",
    status: "completed",
    source: "push",
    branch: "main",
    commitSha: "abc123",
    webhookDeliveryId: "delivery_stage7c",
    pullRequestNumber: null,
    error: null,
    startedAt: "2026-06-16T00:59:00.000Z",
    completedAt: "2026-06-16T01:00:00.000Z",
    summary: {
      critical: 0,
      high: 1,
      medium: 1,
      low: 0,
      info: 0,
    },
  };
}

function createFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding_stage7c",
    repositoryId: "repo_stage7c",
    scanJobId: "scan_stage7c",
    ruleId: "missing-api-auth",
    title: "API route does not enforce authentication",
    category: "missing-auth",
    severity: "high",
    confidence: 0.9,
    status: "open",
    lifecycleStatus: "new",
    firstSeenAt: "2026-06-16T00:00:00.000Z",
    lastSeenAt: "2026-06-16T01:00:00.000Z",
    resolvedAt: null,
    occurrenceCount: 1,
    fingerprint: "fp_auth",
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
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T01:00:00.000Z",
    ...overrides,
  };
}

function createMemory(
  overrides: Partial<FixDecisionMemory> = {},
): FixDecisionMemory {
  return {
    id: "fixmem_stage7c",
    teamId: "team_dev",
    repositoryId: "repo_stage7c",
    findingFingerprint: "fp_auth",
    ruleId: "missing-api-auth",
    decisionType: "fix_accepted",
    proposalId: null,
    findingId: null,
    rationale: null,
    patchHash: null,
    recommendedFixHash: null,
    proposalKind: "patch",
    actorUserId: null,
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    ...overrides,
  };
}

function createVerificationResult(): VerificationResult {
  return {
    id: "verification_stage7c",
    fixProposalId: "fix_stage7c",
    status: "passed",
    scannerRerunStatus: "passed",
    testCommand: "pnpm scanner:test",
    testOutputSummary: "Scanner check passed.",
    evidence: ["missing-api-auth resolved"],
    createdAt: "2026-06-16T01:00:00.000Z",
    updatedAt: "2026-06-16T01:00:00.000Z",
  };
}
