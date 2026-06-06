import type { ScanJob, ScanStatus } from "@autocyber/core";
import type { PersistenceStore } from "./persistence/store";

export interface MonitoringHistoryItem {
  id: string;
  repositoryId: string;
  repositoryName: string;
  status: ScanStatus;
  source: ScanJob["source"];
  branch: string;
  commitSha: string;
  webhookDeliveryId: string | null;
  pullRequestNumber: number | null;
  findingCount: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MonitoringHistorySummary {
  total: number;
  latestStatus: ScanStatus | null;
  byStatus: Record<ScanStatus, number>;
  findingCount: number;
  hasFailures: boolean;
}

export async function getMonitoringHistory(store: PersistenceStore): Promise<MonitoringHistoryItem[]> {
  const [repositories, scanJobs, findings] = await Promise.all([store.listRepositories(), store.listScanJobs(), store.listFindings()]);
  const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]));

  return [...scanJobs]
    .sort((a, b) => compareNullableDates(b.startedAt ?? b.completedAt, a.startedAt ?? a.completedAt))
    .map((scanJob) => {
      const repository = repositoriesById.get(scanJob.repositoryId);
      return {
        id: scanJob.id,
        repositoryId: scanJob.repositoryId,
        repositoryName: repository ? `${repository.owner}/${repository.name}` : "Unknown repository",
        status: scanJob.status,
        source: scanJob.source,
        branch: scanJob.branch,
        commitSha: scanJob.commitSha,
        webhookDeliveryId: scanJob.webhookDeliveryId,
        pullRequestNumber: scanJob.pullRequestNumber,
        findingCount: findings.filter((finding) => finding.scanJobId === scanJob.id).length,
        error: scanJob.error,
        startedAt: scanJob.startedAt,
        completedAt: scanJob.completedAt
      };
    });
}

export function summarizeMonitoringHistory(items: MonitoringHistoryItem[]): MonitoringHistorySummary {
  return items.reduce<MonitoringHistorySummary>(
    (summary, item, index) => {
      summary.total += 1;
      if (index === 0) summary.latestStatus = item.status;
      summary.byStatus[item.status] += 1;
      summary.findingCount += item.findingCount;
      if (item.status === "failed") summary.hasFailures = true;
      return summary;
    },
    {
      total: 0,
      latestStatus: null,
      byStatus: { queued: 0, running: 0, completed: 0, failed: 0 },
      findingCount: 0,
      hasFailures: false
    }
  );
}

function compareNullableDates(left: string | null, right: string | null): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return new Date(left).getTime() - new Date(right).getTime();
}
