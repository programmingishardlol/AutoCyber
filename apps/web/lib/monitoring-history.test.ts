import { describe, expect, it } from "vitest";
import type { MonitoringHistoryItem } from "./monitoring-history";
import { getMonitoringHistory, summarizeMonitoringHistory } from "./monitoring-history";
import { createDevPersistenceStore } from "./persistence/store";

describe("monitoring history display helpers", () => {
  it("summarizes queued, running, completed, and failed scan states", () => {
    const items: MonitoringHistoryItem[] = [
      historyItem("scan_queued", "queued", 0),
      historyItem("scan_running", "running", 0),
      historyItem("scan_completed", "completed", 3),
      historyItem("scan_failed", "failed", 0, "AutoCyber could not complete the monitoring scan.")
    ];

    const summary = summarizeMonitoringHistory(items);

    expect(summary.total).toBe(4);
    expect(summary.latestStatus).toBe("queued");
    expect(summary.byStatus).toEqual({
      queued: 1,
      running: 1,
      completed: 1,
      failed: 1
    });
    expect(summary.findingCount).toBe(3);
    expect(summary.hasFailures).toBe(true);
  });

  it("sorts queued and running webhook scans ahead of older completed scans", async () => {
    const store = createDevPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "programmingishardlol",
      name: "autocyber-private-stage6-test",
      defaultBranch: "main",
      url: "https://github.com/programmingishardlol/autocyber-private-stage6-test",
      installationId: "123456",
      isPrivate: true,
      connectionType: "github_app",
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
    });
    const completed = await store.createScanJob({
      repositoryId: repository.id,
      source: "manual",
      branch: "main",
      commitSha: "completed",
      status: "running",
    });
    await store.completeScanJob(completed.id, {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    const queued = await store.createScanJob({
      repositoryId: repository.id,
      source: "push",
      branch: "main",
      commitSha: "queued",
      webhookDeliveryId: "delivery-queued",
      status: "queued",
    });

    const history = await getMonitoringHistory(store);

    expect(history[0]).toMatchObject({
      id: queued.id,
      status: "queued",
      source: "push",
      webhookDeliveryId: "delivery-queued",
    });
  });
});

function historyItem(id: string, status: MonitoringHistoryItem["status"], findingCount: number, error: string | null = null): MonitoringHistoryItem {
  return {
    id,
    repositoryId: "repo_demo",
    repositoryName: "programmingishardlol/autocyber-stage4-test",
    status,
    source: id === "scan_completed" ? "pull_request" : "push",
    branch: "main",
    commitSha: "abc123",
    webhookDeliveryId: `delivery-${id}`,
    pullRequestNumber: id === "scan_completed" ? 42 : null,
    findingCount,
    error,
    startedAt: null,
    completedAt: status === "completed" || status === "failed" ? "2026-06-04T10:00:00.000Z" : null
  };
}
