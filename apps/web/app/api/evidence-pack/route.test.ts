import { beforeEach, describe, expect, it } from "vitest";
import { getPersistenceStore } from "../../../lib/persistence/store";
import { POST } from "./route";

describe("evidence pack API", () => {
  beforeEach(() => {
    process.env.AUTOCYBER_PERSISTENCE = "dev";
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("returns a redacted markdown evidence pack for a repository scan", async () => {
    const store = getPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "acme",
      name: "evidence-api-app",
      defaultBranch: "main",
      url: "https://github.com/acme/evidence-api-app",
      installationId: "123",
      isPrivate: true,
      connectionType: "github_app",
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
    });
    const scanJob = await store.createScanJob({
      repositoryId: repository.id,
      source: "manual",
      branch: "main",
      commitSha: "unknown",
    });
    await store.saveFindings([
      {
        id: "finding_evidence_api_secret",
        repositoryId: repository.id,
        scanJobId: scanJob.id,
        ruleId: "exposed-secret",
        title: "Potential secret committed to repository",
        category: "secrets",
        severity: "critical",
        confidence: 0.98,
        status: "open",
        lifecycleStatus: "new",
        firstSeenAt: "2026-06-16T00:00:00.000Z",
        lastSeenAt: "2026-06-16T00:00:00.000Z",
        resolvedAt: null,
        occurrenceCount: 1,
        fingerprint: "fp_api_secret",
        previousFindingId: null,
        memoryStatus: "none",
        stackTags: ["node"],
        affectedFile: ".env",
        evidence: [
          {
            filePath: ".env",
            startLine: 1,
            endLine: 1,
            snippet: "OPENAI_API_KEY=sk-testsecretvalue1234567890",
          },
        ],
        riskExplanation: "Leaked secrets can be abused.",
        remediationSummary: "Remove and rotate the key.",
        verificationStrategy: "Rerun scanner.",
        autofixAvailable: false,
      },
    ]);
    await store.completeScanJob(scanJob.id, {
      critical: 1,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    await store.recordFixDecisionMemory({
      repositoryId: repository.id,
      findingFingerprint: "fp_api_secret",
      ruleId: "exposed-secret",
      decisionType: "manual_fix_preferred",
      rationale: "Rotate outside AutoCyber.",
    });
    await store.saveFixProposal({
      id: "fix_unrelated_verification",
      findingId: "finding_unrelated",
      repositoryId: "repo_unrelated",
      status: "approved",
      kind: "patch",
      title: "Unrelated fix",
      explanation: "Unrelated.",
      proposedPatch: "Unrelated.",
      diff: "--- a/unrelated.ts\n+++ b/unrelated.ts",
      risk: "Low.",
      verificationPlan: ["Rerun scanner."],
      filesChanged: ["unrelated.ts"],
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:00:00.000Z",
    });
    await store.saveVerificationResult({
      id: "verification_unrelated",
      fixProposalId: "fix_unrelated_verification",
      status: "passed",
      scannerRerunStatus: "passed",
      testCommand: "pnpm test",
      testOutputSummary: "Unrelated verification passed.",
      evidence: ["unrelated"],
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:00:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost/api/evidence-pack", {
        method: "POST",
        body: JSON.stringify({ scanJobId: scanJob.id }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.evidencePack.summary.totalFindings).toBe(1);
    expect(body.evidencePack.markdown).toContain(
      "Repository: acme/evidence-api-app",
    );
    expect(body.evidencePack.markdown).toContain("Scan: " + scanJob.id);
    expect(body.evidencePack.markdown).toContain("Manual fix preferred");
    expect(body.evidencePack.markdown).toContain(
      "Verification: No verification results attached",
    );
    expect(body.evidencePack.markdown).not.toContain("1 passed");
    expect(body.evidencePack.markdown).not.toContain(
      "sk-testsecretvalue1234567890",
    );
  });

  it("rejects missing repository and scan selectors safely", async () => {
    const response = await POST(
      new Request("http://localhost/api/evidence-pack", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toContain("scanJobId or repositoryId");
  });
});
