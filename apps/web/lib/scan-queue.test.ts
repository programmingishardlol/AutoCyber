import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScannerResult } from "@autocyber/scanner";
import { createDevPersistenceStore } from "./persistence/store";
import { enqueueScanJob, processQueuedScanJobs, processScanJob, retryScanJob } from "./scan-queue";

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

    const result = await processScanJob(store, scanJob.id, {
      fetchPublicGitHubRepository: async (input) => input.scan(repositoryPath),
    });
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

  it("does not use the test clone path override for public GitHub monitoring scans", async () => {
    const overrideRepo = await createVulnerableRepo();
    const actualRepo = await createVulnerableRepo();
    vi.stubEnv("AUTOCYBER_TEST_GITHUB_CLONE_PATH", overrideRepo);
    const store = createDevPersistenceStore();
    const repository = await seedRepository(store);
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "abc-public",
      webhookDeliveryId: "delivery-public",
      pullRequestNumber: null,
    });
    const scannedPaths: string[] = [];

    const result = await processScanJob(store, scanJob.id, {
      fetchPublicGitHubRepository: async (input) => input.scan(actualRepo),
      scanRepositoryPath: async (repositoryPath, repositoryId, scanJobId) => {
        scannedPaths.push(repositoryPath);
        return createScannerResult({
          repositoryPath,
          repositoryId,
          scanJobId,
          findingId: "finding_public",
          findingRepositoryId: repositoryId,
          findingScanJobId: scanJobId,
        });
      },
    });

    expect(result.status).toBe("completed");
    expect(scannedPaths).toEqual([actualRepo]);
    expect(scannedPaths).not.toContain(overrideRepo);
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

  it("keeps findings separated for two queued scans under the same GitHub installation", async () => {
    const store = createDevPersistenceStore();
    const repoA = await seedPrivateRepository(store, "repo-a");
    const repoB = await seedPrivateRepository(store, "repo-b");
    const scanA = await enqueueScanJob(store, {
      repositoryId: repoA.id,
      source: "push",
      branch: "main",
      commitSha: "sha-a",
      webhookDeliveryId: "delivery-a",
      pullRequestNumber: null,
    });
    const scanB = await enqueueScanJob(store, {
      repositoryId: repoB.id,
      source: "push",
      branch: "main",
      commitSha: "sha-b",
      webhookDeliveryId: "delivery-b",
      pullRequestNumber: null,
    });

    await processScanJob(store, scanA.id, {
      fetchPrivateGitHubRepository: async (input) =>
        input.scan(`/tmp/${input.repository.name}`),
      scanRepositoryPath: async (_repositoryPath, repositoryId, scanJobId) => ({
        scanner: "local",
        repositoryPath: `/tmp/${repositoryId}`,
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
            id: `finding_${repositoryId}`,
            repositoryId,
            scanJobId,
            severity: "high",
            title: `Finding for ${repositoryId}`,
          }),
        ],
        filesScanned: 1,
        rulesRun: ["missing-api-auth"],
        errors: [],
      }),
    });
    await processScanJob(store, scanB.id, {
      fetchPrivateGitHubRepository: async (input) =>
        input.scan(`/tmp/${input.repository.name}`),
      scanRepositoryPath: async (_repositoryPath, repositoryId, scanJobId) => ({
        scanner: "local",
        repositoryPath: `/tmp/${repositoryId}`,
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
            id: `finding_${repositoryId}`,
            repositoryId,
            scanJobId,
            severity: "critical",
            title: `Finding for ${repositoryId}`,
          }),
        ],
        filesScanned: 1,
        rulesRun: ["missing-api-auth"],
        errors: [],
      }),
    });

    const snapshot = store.snapshot();
    expect(snapshot.scanJobs.find((scan) => scan.id === scanA.id)).toMatchObject({
      repositoryId: repoA.id,
      status: "completed",
    });
    expect(snapshot.scanJobs.find((scan) => scan.id === scanB.id)).toMatchObject({
      repositoryId: repoB.id,
      status: "completed",
    });
    expect(snapshot.findings.filter((finding) => finding.repositoryId === repoA.id)).toHaveLength(1);
    expect(snapshot.findings.filter((finding) => finding.repositoryId === repoB.id)).toHaveLength(1);
    expect(snapshot.findings.find((finding) => finding.repositoryId === repoA.id)?.scanJobId).toBe(scanA.id);
    expect(snapshot.findings.find((finding) => finding.repositoryId === repoB.id)?.scanJobId).toBe(scanB.id);
  });

  it("normalizes helper output to the active repository and scan context before saving findings and notifications", async () => {
    const store = createDevPersistenceStore();
    const repository = await seedPrivateRepository(store, "context-private-app");
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "pull_request",
      branch: "feature/context",
      commitSha: "context123",
      webhookDeliveryId: "delivery-context",
      pullRequestNumber: 101,
    });

    const result = await processScanJob(store, scanJob.id, {
      fetchPrivateGitHubRepository: async () =>
        createScannerResult({
          repositoryPath: "/tmp/helper-context",
          repositoryId: "repo_helper",
          scanJobId: "scan_helper",
          findingId: "finding_helper_plain",
          findingRepositoryId: "repo_helper",
          findingScanJobId: "scan_helper",
        }),
    });
    const snapshot = store.snapshot();
    const finding = snapshot.findings.find((candidate) => candidate.id === "finding_helper_plain");
    const findingNotification = snapshot.notifications.find((notification) => notification.findingId === "finding_helper_plain");

    expect(result.status).toBe("completed");
    expect(finding).toMatchObject({
      repositoryId: repository.id,
      scanJobId: scanJob.id,
    });
    expect(findingNotification).toMatchObject({
      repositoryId: repository.id,
      scanJobId: scanJob.id,
    });
  });

  it("fails safely before persistence when a finding id encodes a different scan context", async () => {
    const store = createDevPersistenceStore();
    const repository = await seedPrivateRepository(store, "mismatched-context-app");
    const scanJob = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "mismatch123",
      webhookDeliveryId: "delivery-mismatch",
      pullRequestNumber: null,
    });

    const result = await processScanJob(store, scanJob.id, {
      fetchPrivateGitHubRepository: async () =>
        createScannerResult({
          repositoryPath: "/tmp/mismatched-context",
          repositoryId: repository.id,
          scanJobId: scanJob.id,
          findingId: "scan_other:local:supabase-permissive-rls-policy:abc123",
          findingRepositoryId: repository.id,
          findingScanJobId: scanJob.id,
        }),
    });
    const snapshot = store.snapshot();

    expect(result.status).toBe("failed");
    expect(snapshot.findings).toHaveLength(0);
    expect(snapshot.notifications).toEqual([
      expect.objectContaining({
        type: "scan_failed",
        findingId: null,
        repositoryId: repository.id,
        scanJobId: scanJob.id,
      }),
    ]);
  });

  it("does not create notifications from stale findings saved by previous scans", async () => {
    const store = createDevPersistenceStore();
    const staleRepo = await seedPrivateRepository(store, "stale-repo");
    const freshRepo = await seedPrivateRepository(store, "fresh-repo");
    const staleScan = await enqueueScanJob(store, {
      repositoryId: staleRepo.id,
      source: "push",
      branch: "main",
      commitSha: "stale123",
      webhookDeliveryId: "delivery-stale",
      pullRequestNumber: null,
    });
    await store.saveFindings([
      createFinding({
        id: "finding_stale_high",
        repositoryId: staleRepo.id,
        scanJobId: staleScan.id,
        severity: "high",
        title: "Stale high finding",
      }),
    ]);
    const freshScan = await enqueueScanJob(store, {
      repositoryId: freshRepo.id,
      source: "push",
      branch: "main",
      commitSha: "fresh123",
      webhookDeliveryId: "delivery-fresh",
      pullRequestNumber: null,
    });

    await processScanJob(store, freshScan.id, {
      fetchPrivateGitHubRepository: async () =>
        createScannerResult({
          repositoryPath: "/tmp/fresh-context",
          repositoryId: freshRepo.id,
          scanJobId: freshScan.id,
          findingId: "finding_fresh_low",
          findingRepositoryId: freshRepo.id,
          findingScanJobId: freshScan.id,
          severity: "low",
        }),
    });
    const notificationFindingIds = store.snapshot().notifications.map((notification) => notification.findingId);

    expect(notificationFindingIds).not.toContain("finding_stale_high");
    expect(store.snapshot().notifications).toEqual([
      expect.objectContaining({
        type: "webhook_scan_completed",
        repositoryId: freshRepo.id,
        scanJobId: freshScan.id,
      }),
    ]);
  });

  it("creates notifications for high and critical findings plus pull request scan completion", async () => {
    const store = createDevPersistenceStore();
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
      fetchPublicGitHubRepository: async (input) => input.scan("/tmp/autocyber-test"),
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
      fetchPublicGitHubRepository: async (input) => input.scan("/tmp/autocyber-test"),
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

  it("processes only queued scans in bounded batches and skips completed scans", async () => {
    const repositoryPath = await createVulnerableRepo();
    const store = createDevPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "local",
      owner: "local",
      name: "worker-repo",
      defaultBranch: "local",
      url: repositoryPath,
    });
    const completedScan = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "completed123",
      webhookDeliveryId: "delivery-completed",
      pullRequestNumber: null,
    });
    await store.completeScanJob(completedScan.id, {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    const firstQueuedScan = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "queued123",
      webhookDeliveryId: "delivery-queued-1",
      pullRequestNumber: null,
    });
    const secondQueuedScan = await enqueueScanJob(store, {
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "queued456",
      webhookDeliveryId: "delivery-queued-2",
      pullRequestNumber: null,
    });

    const result = await processQueuedScanJobs(store, { limit: 1 });
    const snapshot = store.snapshot();

    expect(result).toMatchObject({
      requestedLimit: 1,
      processed: 1,
      completed: 1,
      failed: 0,
      remainingQueued: 1,
    });
    expect(snapshot.scanJobs.find((scan) => scan.id === completedScan.id)).toMatchObject({
      status: "completed",
      commitSha: "completed123",
    });
    expect(snapshot.scanJobs.find((scan) => scan.id === firstQueuedScan.id)).toMatchObject({
      status: "completed",
    });
    expect(snapshot.scanJobs.find((scan) => scan.id === secondQueuedScan.id)).toMatchObject({
      status: "queued",
    });
    expect(snapshot.notifications.map((notification) => notification.type)).toContain("webhook_scan_completed");
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

async function seedPrivateRepository(
  store: ReturnType<typeof createDevPersistenceStore>,
  name: string,
) {
  return store.upsertRepository({
    projectId: "proj_dev",
    provider: "github",
    owner: "acme",
    name,
    defaultBranch: "main",
    url: `https://github.com/acme/${name}`,
    installationId: "98765",
    isPrivate: true,
    connectionType: "github_app",
    canScan: true,
    canMonitor: true,
    canOpenPr: false,
    permissionsSummary: {
      contents: "read",
      pullRequests: "read",
    },
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

function createScannerResult(input: {
  repositoryPath: string;
  repositoryId: string;
  scanJobId: string;
  findingId: string;
  findingRepositoryId: string;
  findingScanJobId: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
}): ScannerResult {
  return {
    scanner: "local",
    repositoryPath: input.repositoryPath,
    repositoryId: input.repositoryId,
    scanJobId: input.scanJobId,
    projectProfile: {
      frameworks: ["nextjs"],
      languages: ["typescript"],
      integrations: [],
      deploymentProviders: [],
      packageManagers: ["pnpm"],
    },
    findings: [
      createFinding({
        id: input.findingId,
        repositoryId: input.findingRepositoryId,
        scanJobId: input.findingScanJobId,
        severity: input.severity ?? "high",
        title: "Context-bound finding",
      }),
    ],
    filesScanned: 1,
    rulesRun: ["missing-api-auth"],
    errors: [],
  };
}
