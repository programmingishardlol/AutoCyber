import { describe, expect, it } from "vitest";
import { createDevPersistenceStore } from "./store";

describe("Stage 5D persistence store", () => {
  it("persists repository, scan, finding, memory, and audit records in dev fallback mode", async () => {
    const store = createDevPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_demo",
      provider: "github",
      owner: "openai",
      name: "codex",
      defaultBranch: "main",
      url: "https://github.com/openai/codex"
    });
    const scanJob = await store.createScanJob({
      repositoryId: repository.id,
      source: "manual",
      branch: "main",
      commitSha: "unknown"
    });

    await store.completeScanJob(scanJob.id, { critical: 0, high: 1, medium: 0, low: 0, info: 0 });
    await store.saveFindings([
      {
        id: "finding_secret",
        repositoryId: repository.id,
        scanJobId: scanJob.id,
        ruleId: "exposed-secret",
        title: "Potential secret committed to repository",
        category: "secrets",
        severity: "high",
        confidence: 0.95,
        status: "open",
        stackTags: ["node"],
        affectedFile: ".env",
        evidence: [{ filePath: ".env", startLine: 1, endLine: 1, snippet: "OPENAI_API_KEY=sk-[REDACTED]" }],
        riskExplanation: "Leaked secrets can be abused.",
        remediationSummary: "Remove and rotate the key.",
        verificationStrategy: "Rerun scanner.",
        autofixAvailable: false
      }
    ]);
    await store.upsertRepoProfileMemory(repository.id, {
      frameworks: ["nextjs"],
      languages: ["typescript"],
      integrations: ["openai"],
      deploymentProviders: ["vercel"],
      packageManagers: ["pnpm"]
    });

    const snapshot = store.snapshot();
    expect(snapshot.repositories).toHaveLength(1);
    expect(snapshot.scanJobs[0]?.status).toBe("completed");
    expect(snapshot.findings).toHaveLength(1);
    expect(snapshot.securityMemories[0]?.kind).toBe("repo_profile");
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual([
      "repo_created",
      "scan_started",
      "scan_completed",
      "finding_created"
    ]);
  });
});
