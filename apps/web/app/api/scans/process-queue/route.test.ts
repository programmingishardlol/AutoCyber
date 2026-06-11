import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getPersistenceStore } from "../../../../lib/persistence/store";
import { POST } from "./route";

describe("scan queue worker API route", () => {
  beforeEach(() => {
    process.env.AUTOCYBER_PERSISTENCE = "dev";
    process.env.AUTOCYBER_QUEUE_WORKER_SECRET = "worker-secret";
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("rejects missing worker secrets without processing queued scans", async () => {
    const store = getPersistenceStore();
    const scanJob = await seedQueuedLocalPushScan();

    const response = await POST(jsonRequest({ limit: 1 }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("queue worker unauthorized");
    expect(
      store.snapshot().scanJobs.find((scan) => scan.id === scanJob.id)?.status,
    ).toBe("queued");
    expect(JSON.stringify(body)).not.toContain("worker-secret");
  });

  it("rejects invalid worker secrets without processing queued scans", async () => {
    const store = getPersistenceStore();
    const scanJob = await seedQueuedLocalPushScan();

    const response = await POST(jsonRequest({ limit: 1 }, "wrong-secret"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("queue worker unauthorized");
    expect(
      store.snapshot().scanJobs.find((scan) => scan.id === scanJob.id)?.status,
    ).toBe("queued");
    expect(JSON.stringify(body)).not.toContain("worker-secret");
  });

  it("processes queued push scans and creates completion notifications", async () => {
    const store = getPersistenceStore();
    const scanJob = await seedQueuedLocalPushScan();

    const response = await POST(jsonRequest({ limit: 1 }, "worker-secret"));
    const body = await response.json();
    const snapshot = store.snapshot();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "processed",
      requestedLimit: 1,
      processed: 1,
      completed: 1,
      failed: 0,
      remainingQueued: 0,
    });
    expect(
      snapshot.scanJobs.find((scan) => scan.id === scanJob.id),
    ).toMatchObject({
      status: "completed",
      source: "push",
    });
    expect(
      snapshot.notifications.map((notification) => notification.type),
    ).toContain("webhook_scan_completed");
    expect(snapshot.repositories[0]?.lastScannedAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("worker-secret");
  });

  it("does not reprocess completed scans", async () => {
    const store = getPersistenceStore();
    const scanJob = await seedQueuedLocalPushScan();
    await store.completeScanJob(scanJob.id, {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });

    const response = await POST(jsonRequest({ limit: 5 }, "worker-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      processed: 0,
      completed: 0,
      failed: 0,
      remainingQueued: 0,
    });
    expect(store.snapshot().notifications).toHaveLength(0);
  });
});

async function seedQueuedLocalPushScan() {
  const store = getPersistenceStore();
  const repositoryPath = await createVulnerableRepo();
  const repository = await store.upsertRepository({
    projectId: "proj_dev",
    provider: "local",
    owner: "local",
    name: "worker-route-repo",
    defaultBranch: "local",
    url: repositoryPath,
  });

  return store.createScanJob({
    repositoryId: repository.id,
    source: "push",
    branch: "main",
    commitSha: "worker123",
    webhookDeliveryId: "delivery-worker-route",
    pullRequestNumber: null,
    status: "queued",
  });
}

async function createVulnerableRepo(): Promise<string> {
  const repositoryPath = await mkdtemp(
    join(tmpdir(), "autocyber-worker-route-repo-"),
  );
  await writeFile(
    join(repositoryPath, "package.json"),
    JSON.stringify({ dependencies: { next: "latest" } }),
  );
  await writeFile(
    join(repositoryPath, ".env"),
    `OPENAI_API_KEY=${fakeOpenAiKey("worker")}`,
  );
  return repositoryPath;
}

function fakeOpenAiKey(label: string): string {
  return ["sk", "proj", `${label}000000000000000000000000000000`].join("-");
}

function jsonRequest(body: unknown, workerSecret?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (workerSecret) headers["x-autocyber-worker-secret"] = workerSecret;
  return new Request("http://localhost/api/scans/process-queue", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
