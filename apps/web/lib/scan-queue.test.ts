import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDevPersistenceStore } from "./persistence/store";
import { enqueueScanJob, processScanJob, retryScanJob } from "./scan-queue";

describe("Stage 6C scan queue", () => {
  beforeEach(() => {
    vi.stubEnv("AUTOCYBER_PERSISTENCE", "dev");
    globalThis.__autocyberPersistenceStore = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("enqueues a scan job without running scanner work", async () => {
    const store = createDevPersistenceStore();
    const repository = await seedRepository(store);

    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "abc123",
      webhookDeliveryId: "delivery-queue-only",
      pullRequestNumber: null,
    });

    const snapshot = store.snapshot();
    expect(scanJob.status).toBe("queued");
    expect(scanJob.startedAt).toBeNull();
    expect(scanJob.completedAt).toBeNull();
    expect(snapshot.findings).toHaveLength(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining(["scan_queued"]),
    );
  });

  it("processes queued scans through running to completed and stores findings", async () => {
    const repositoryPath = await createVulnerableRepo();
    vi.stubEnv("AUTOCYBER_TEST_GITHUB_CLONE_PATH", repositoryPath);
    const store = createDevPersistenceStore();
    const repository = await seedRepository(store);
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "pull_request",
      branch: "feature/security",
      commitSha: "def456",
      webhookDeliveryId: "delivery-process",
      pullRequestNumber: 12,
    });

    const result = await processScanJob(store, scanJob.id);
    const snapshot = store.snapshot();

    expect(result.status).toBe("completed");
    expect(snapshot.scanJobs[0]).toMatchObject({
      id: scanJob.id,
      status: "completed",
      source: "pull_request",
      branch: "feature/security",
      commitSha: "def456",
      webhookDeliveryId: "delivery-process",
      pullRequestNumber: 12,
      error: null,
    });
    expect(snapshot.scanJobs[0]?.startedAt).toEqual(expect.any(String));
    expect(snapshot.scanJobs[0]?.completedAt).toEqual(expect.any(String));
    expect(snapshot.findings.length).toBeGreaterThan(0);
    expect(
      snapshot.securityMemories.some(
        (memory) => memory.kind === "repo_profile",
      ),
    ).toBe(true);
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "scan_running",
        "finding_created",
        "scan_completed",
        "monitoring_scan_completed",
      ]),
    );
  });

  it("marks scan job failed without leaking internal errors", async () => {
    const store = createDevPersistenceStore();
    const repositoryPath = await createVulnerableRepo();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "local",
      owner: "local",
      name: "failing-repo",
      defaultBranch: "local",
      url: repositoryPath,
    });
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "bad123",
      webhookDeliveryId: "delivery-failure",
      pullRequestNumber: null,
    });

    const result = await processScanJob(store, scanJob.id, {
      scanRepositoryPath: async () => {
        throw new Error(
          `raw token ${fakeGitHubToken("secret")} should not leak`,
        );
      },
    });
    const snapshot = store.snapshot();

    expect(result.status).toBe("failed");
    expect(snapshot.scanJobs[0]).toMatchObject({
      status: "failed",
      error: "AutoCyber could not complete the monitoring scan.",
    });
    expect(JSON.stringify(result)).not.toContain(fakeGitHubToken("secret"));
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "monitoring_scan_failed",
    );
    expect(snapshot.notifications).toEqual([
      expect.objectContaining({
        type: "scan_failed",
        severity: "high",
        repositoryId: repository.id,
        scanJobId: scanJob.id,
        status: "unread",
      }),
    ]);
    expect(JSON.stringify(snapshot.notifications)).not.toContain(
      fakeGitHubToken("secret"),
    );
  });

  it("fails safely when a queued scan references an unknown repository", async () => {
    const store = createDevPersistenceStore();
    const scanJob = await enqueueScanJob(store, {
      repositoryId: "repo_missing",
      source: "push",
      branch: "main",
      commitSha: "missing123",
      webhookDeliveryId: "delivery-missing-repo",
      pullRequestNumber: null,
    });

    const result = await processScanJob(store, scanJob.id);
    const snapshot = store.snapshot();

    expect(result).toEqual({
      status: "failed",
      scanJobId: scanJob.id,
      error: "Repository was not found for this monitoring scan.",
    });
    expect(snapshot.scanJobs[0]).toMatchObject({
      status: "failed",
      error: "Repository was not found for this monitoring scan.",
    });
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "monitoring_scan_failed",
    );
  });

  it("fails private GitHub monitoring safely when the repository has no installation id", async () => {
    const store = createDevPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "acme",
      name: "private-app",
      defaultBranch: "main",
      url: "https://github.com/acme/private-app",
      installationId: null,
      isPrivate: true,
    });
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "private123",
      webhookDeliveryId: "delivery-private-no-installation",
      pullRequestNumber: null,
    });

    const result = await processScanJob(store, scanJob.id);
    const snapshot = store.snapshot();

    expect(result).toEqual({
      status: "failed",
      scanJobId: scanJob.id,
      error: "Private repository scanning requires GitHub App installation.",
    });
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "failed",
      error: "Private repository scanning requires GitHub App installation.",
    });
    expect(
      snapshot.notifications.map((notification) => notification.type),
    ).toEqual(
      expect.arrayContaining(["scan_failed", "private_repo_fetch_failed"]),
    );
    expect(JSON.stringify(snapshot.notifications)).not.toContain("ghs_");
  });

  it("uses the private GitHub fetch path for private repositories with installation ids", async () => {
    const store = createDevPersistenceStore();
    const repositoryPath = await createVulnerableRepo();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "acme",
      name: "private-app",
      defaultBranch: "main",
      url: "https://github.com/acme/private-app",
      installationId: "98765",
      isPrivate: true,
    });
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "pull_request",
      branch: "feature/private",
      commitSha: "private456",
      webhookDeliveryId: "delivery-private-installation",
      pullRequestNumber: 77,
    });
    const privateFetchCalls: string[] = [];

    const result = await processScanJob(store, scanJob.id, {
      fetchPrivateGitHubRepository: async (input) => {
        privateFetchCalls.push(
          `${input.repository.owner}/${input.repository.name}:${input.repository.installationId}`,
        );
        return input.scan(repositoryPath);
      },
    });
    const snapshot = store.snapshot();

    expect(result.status).toBe("completed");
    expect(privateFetchCalls).toEqual(["acme/private-app:98765"]);
    expect(snapshot.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("ghs_");
  });

  it("creates notifications for high and critical findings plus pull request scan completion", async () => {
    const store = createDevPersistenceStore();
    vi.stubEnv(
      "AUTOCYBER_TEST_GITHUB_CLONE_PATH",
      await createVulnerableRepo(),
    );
    const repository = await seedRepository(store);
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "pull_request",
      branch: "feature/high-risk",
      commitSha: "abc-high",
      webhookDeliveryId: "delivery-high",
      pullRequestNumber: 42,
    });

    await processScanJob(store, scanJob.id, {
      scanRepositoryPath: async (_repositoryPath, repositoryId, scanJobId) => ({
        scanner: "local",
        repositoryPath: "/tmp/autocyber-test",
        repositoryId,
        scanJobId,
        projectProfile: {
          frameworks: ["nextjs"],
          languages: ["typescript"],
          integrations: [],
          deploymentProviders: [],
          packageManagers: ["pnpm"],
        },
        findings: [
          createFinding({
            id: "finding_high",
            repositoryId,
            scanJobId,
            severity: "high",
            title: "High risk auth bypass",
          }),
          createFinding({
            id: "finding_critical",
            repositoryId,
            scanJobId,
            severity: "critical",
            title: "Critical exposed admin token",
          }),
          createFinding({
            id: "finding_low",
            repositoryId,
            scanJobId,
            severity: "low",
            title: "Low severity hygiene issue",
          }),
        ],
        filesScanned: 3,
        rulesRun: ["missing-api-auth"],
        errors: [],
      }),
    });

    const snapshot = store.snapshot();
    expect(
      snapshot.notifications.map((notification) => notification.type),
    ).toEqual(
      expect.arrayContaining([
        "high_severity_finding_detected",
        "critical_finding_detected",
        "pull_request_scan_completed",
        "new_findings_detected",
      ]),
    );
    expect(
      snapshot.notifications.some(
        (notification) => notification.findingId === "finding_low",
      ),
    ).toBe(false);
    expect(JSON.stringify(snapshot.notifications)).not.toContain("token_value");
  });

  it("does not create noisy notifications for low or info findings", async () => {
    const store = createDevPersistenceStore();
    vi.stubEnv(
      "AUTOCYBER_TEST_GITHUB_CLONE_PATH",
      await createVulnerableRepo(),
    );
    const repository = await seedRepository(store);
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "abc-low",
      webhookDeliveryId: "delivery-low",
      pullRequestNumber: null,
    });

    await processScanJob(store, scanJob.id, {
      scanRepositoryPath: async (_repositoryPath, repositoryId, scanJobId) => ({
        scanner: "local",
        repositoryPath: "/tmp/autocyber-test",
        repositoryId,
        scanJobId,
        projectProfile: {
          frameworks: [],
          languages: ["typescript"],
          integrations: [],
          deploymentProviders: [],
          packageManagers: ["pnpm"],
        },
        findings: [
          createFinding({
            id: "finding_low_only",
            repositoryId,
            scanJobId,
            severity: "low",
            title: "Low severity hygiene issue",
          }),
          createFinding({
            id: "finding_info_only",
            repositoryId,
            scanJobId,
            severity: "info",
            title: "Informational dependency note",
          }),
        ],
        filesScanned: 2,
        rulesRun: ["missing-api-auth"],
        errors: [],
      }),
    });

    expect(
      store.snapshot().notifications.map((notification) => notification.type),
    ).toEqual(["webhook_scan_completed"]);
  });

  it("marks notifications read and dismissed with audit logs", async () => {
    const store = createDevPersistenceStore();
    const notification = await store.createNotification({
      repositoryId: "repo_demo",
      scanJobId: "scan_demo",
      findingId: null,
      type: "scan_failed",
      severity: "high",
      title: "Scan failed",
      message: "AutoCyber could not complete the monitoring scan.",
    });

    await store.markNotificationRead(notification.id);
    await store.dismissNotification(notification.id);

    const snapshot = store.snapshot();
    expect(snapshot.notifications[0]).toMatchObject({
      id: notification.id,
      status: "dismissed",
    });
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "notification_created",
        "notification_read",
        "notification_dismissed",
      ]),
    );
  });

  it("retries a failed scan by creating a new queued scan job", async () => {
    const store = createDevPersistenceStore();
    const repository = await seedRepository(store);
    const failedScan = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "abc123",
      webhookDeliveryId: "delivery-retry",
      pullRequestNumber: null,
    });
    await store.failScanJob(failedScan.id, "safe failure");

    const retry = await retryScanJob(store, failedScan.id);

    expect(retry.status).toBe("queued");
    expect(retry.id).not.toBe(failedScan.id);
    expect(retry.repositoryId).toBe(repository.id);
    expect(retry.branch).toBe("main");
    expect(retry.commitSha).toBe("abc123");
    expect(retry.webhookDeliveryId).toBeNull();
    expect(store.snapshot().scanJobs).toHaveLength(2);
  });
});

async function seedRepository(
  store: ReturnType<typeof createDevPersistenceStore>,
) {
  return store.upsertRepository({
    projectId: "proj_dev",
    provider: "github",
    owner: "programmingishardlol",
    name: "autocyber-stage4-test",
    defaultBranch: "main",
    url: "https://github.com/programmingishardlol/autocyber-stage4-test",
  });
}

async function createVulnerableRepo(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), "autocyber-queue-repo-"));
  await writeFile(
    join(repositoryPath, "package.json"),
    JSON.stringify({ dependencies: { next: "latest" } }),
  );
  await writeFile(
    join(repositoryPath, ".env"),
    envLine("OPENAI_API_KEY", fakeOpenAiKey("queue")),
  );
  return repositoryPath;
}

function envLine(name: string, value: string): string {
  return `${name}=${value}`;
}

function fakeOpenAiKey(label: string): string {
  return ["sk", "proj", `${label}000000000000000000000000000000`].join("-");
}

function fakeGitHubToken(label: string): string {
  return ["ghp", label].join("_");
}

function createFinding(input: {
  id: string;
  repositoryId: string;
  scanJobId: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
}) {
  return {
    id: input.id,
    repositoryId: input.repositoryId,
    scanJobId: input.scanJobId,
    ruleId: "missing-api-auth" as const,
    title: input.title,
    category: "security",
    severity: input.severity,
    confidence: 0.9,
    status: "open" as const,
    stackTags: ["nextjs" as const],
    affectedFile: "app/api/demo/route.ts",
    evidence: [
      {
        filePath: "app/api/demo/route.ts",
        startLine: 1,
        endLine: 1,
        snippet: "SECRET=token_value",
      },
    ],
    riskExplanation: "Risk explanation.",
    remediationSummary: "Fix this issue.",
    verificationStrategy: "Rerun scanner.",
    autofixAvailable: false,
  };
}
