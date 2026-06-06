import { beforeEach, describe, expect, it } from "vitest";
import { getPersistenceStore } from "../../../../lib/persistence/store";
import { POST } from "./route";

describe("scan retry API route", () => {
  beforeEach(() => {
    process.env.AUTOCYBER_PERSISTENCE = "dev";
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("creates a new queued scan job for a failed scan", async () => {
    const store = getPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "programmingishardlol",
      name: "autocyber-stage4-test",
      defaultBranch: "main",
      url: "https://github.com/programmingishardlol/autocyber-stage4-test"
    });
    const failedScan = await store.createScanJob({
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "abc123",
      webhookDeliveryId: "delivery-failed",
      pullRequestNumber: null,
      status: "queued"
    });
    await store.failScanJob(failedScan.id, "safe failure");

    const response = await POST(jsonRequest({ scanJobId: failedScan.id }));
    const body = await response.json();
    const snapshot = store.snapshot();

    expect(response.status).toBe(202);
    expect(body.status).toBe("queued");
    expect(body.scanJob.id).not.toBe(failedScan.id);
    expect(body.scanJob.source).toBe("push");
    expect(snapshot.scanJobs).toHaveLength(2);
    expect(snapshot.auditLogs.map((log) => log.action)).toContain("scan_retry_queued");
  });

  it("rejects retry requests for non-failed scans safely", async () => {
    const store = getPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "programmingishardlol",
      name: "autocyber-stage4-test",
      defaultBranch: "main",
      url: "https://github.com/programmingishardlol/autocyber-stage4-test"
    });
    const queuedScan = await store.createScanJob({
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "abc123",
      status: "queued"
    });

    const response = await POST(jsonRequest({ scanJobId: queuedScan.id }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("scan retry unavailable");
    expect(JSON.stringify(body)).not.toContain("Error:");
  });

  it("rejects retry requests for missing scan ids safely", async () => {
    const response = await POST(jsonRequest({ scanJobId: "scan_missing" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("scan retry unavailable");
    expect(body.message).toBe("Only failed scan jobs can be retried.");
    expect(JSON.stringify(body)).not.toContain("Error:");
  });

  it("rejects retry requests for completed scans safely", async () => {
    const store = getPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "programmingishardlol",
      name: "autocyber-stage4-test",
      defaultBranch: "main",
      url: "https://github.com/programmingishardlol/autocyber-stage4-test"
    });
    const completedScan = await store.createScanJob({
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "abc123",
      status: "queued"
    });
    await store.completeScanJob(completedScan.id, {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    });

    const response = await POST(jsonRequest({ scanJobId: completedScan.id }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("scan retry unavailable");
    expect(body.message).toBe("Only failed scan jobs can be retried.");
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/scans/retry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
