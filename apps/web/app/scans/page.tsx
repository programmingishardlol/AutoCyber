import { StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { generateEvidencePack, type EvidencePack } from "@/lib/evidence-pack";
import {
  getMonitoringHistory,
  summarizeMonitoringHistory,
} from "@/lib/monitoring-history";
import {
  getPersistenceStore,
  type PersistenceStore,
} from "@/lib/persistence/store";
import { formatDateTime } from "@/lib/utils";
import { RetryScanButton } from "./retry-scan-button";

export const dynamic = "force-dynamic";

const sourceLabels = {
  manual: "Manual",
  push: "Push",
  pull_request: "Pull request",
  scheduled: "Scheduled",
};

export default async function ScansPage() {
  const store = getPersistenceStore();
  const history = await getMonitoringHistory(store);
  const summary = summarizeMonitoringHistory(history);
  const evidencePack = await getLatestEvidencePack(store);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring history"
        description="Continuous monitoring scan jobs from manual scans, GitHub push events, and pull request events."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryStat
          label="Latest status"
          value={summary.latestStatus?.replaceAll("_", " ") ?? "No scans"}
        />
        <SummaryStat label="Total scans" value={String(summary.total)} />
        <SummaryStat
          label="Completed"
          value={String(summary.byStatus.completed)}
        />
        <SummaryStat
          label="Failed"
          value={String(summary.byStatus.failed)}
          tone={summary.hasFailures ? "warning" : "default"}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryStat
          label="New findings"
          value={String(summary.lifecycle.new)}
        />
        <SummaryStat
          label="Existing findings"
          value={String(summary.lifecycle.existing)}
        />
        <SummaryStat
          label="Resolved findings"
          value={String(summary.lifecycle.resolved)}
        />
        <SummaryStat
          label="Reappeared findings"
          value={String(summary.lifecycle.reappeared)}
          tone={summary.lifecycle.reappeared > 0 ? "warning" : "default"}
        />
      </div>

      {summary.byStatus.queued > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          Queued webhook scans are waiting for the queue worker. Run the
          protected queue worker endpoint to process pending push and pull
          request scans.
        </section>
      ) : null}

      {evidencePack ? (
        <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">
                Security review summary
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Copyable evidence pack for the latest completed scan, including
                lifecycle changes, top active risks, fix decision memory,
                verification status, and next actions.
              </p>
            </div>
            <StatusBadge status="completed" />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-5">
            <SummaryStat
              label="Top risks"
              value={String(evidencePack.topActiveRisks.length)}
            />
            <SummaryStat
              label="New"
              value={String(evidencePack.summary.newFindings)}
            />
            <SummaryStat
              label="Resolved"
              value={String(evidencePack.summary.resolvedFindings)}
            />
            <SummaryStat
              label="Reappeared"
              value={String(evidencePack.summary.reappearedFindings)}
              tone={
                evidencePack.summary.reappearedFindings > 0
                  ? "warning"
                  : "default"
              }
            />
            <SummaryStat
              label="False positive"
              value={String(
                evidencePack.summary.falsePositiveSuppressedFindings,
              )}
            />
          </div>
          <textarea
            readOnly
            value={evidencePack.markdown}
            className="mt-5 h-80 w-full rounded-md border border-border bg-slate-50 p-4 font-mono text-xs leading-5 text-slate-800"
            aria-label="Copyable AutoCyber evidence pack"
          />
        </section>
      ) : null}

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-sm text-slate-600">
          No monitoring scans have been recorded yet. Connect a GitHub
          repository and send a signed webhook event to create queued scans.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-surface">
          <table className="w-full min-w-[1200px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[15%]" />
              <col className="w-[6%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Repository</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Commit</th>
                <th className="px-4 py-3">PR</th>
                <th className="px-4 py-3">Lifecycle</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((scan) => (
                <tr key={scan.id}>
                  <td className="px-4 py-4 align-top">
                    <div className="break-words font-medium text-slate-950">
                      {scan.repositoryName}
                    </div>
                    {scan.webhookDeliveryId ? (
                      <div className="mt-1 break-all text-xs text-slate-500">
                        Delivery {scan.webhookDeliveryId}
                      </div>
                    ) : null}
                    {scan.error ? (
                      <div className="mt-2 max-w-md text-xs font-medium text-red-700">
                        {scan.error}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <StatusBadge status={scan.status} />
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">
                    {sourceLabels[scan.source]}
                  </td>
                  <td className="break-words px-4 py-4 align-top text-slate-600">
                    {scan.branch}
                  </td>
                  <td className="break-all px-4 py-4 align-top font-mono text-xs text-slate-600">
                    {scan.commitSha}
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">
                    {scan.pullRequestNumber
                      ? `#${scan.pullRequestNumber}`
                      : "None"}
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">
                    <div>{scan.findingCount} total</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {scan.lifecycle.new} new / {scan.lifecycle.existing}{" "}
                      existing / {scan.lifecycle.resolved} resolved /{" "}
                      {scan.lifecycle.reappeared} reappeared
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">
                    {formatDateTime(scan.completedAt)}
                  </td>
                  <td className="px-4 py-4 align-top">
                    {scan.status === "failed" ? (
                      <RetryScanButton scanJobId={scan.id} />
                    ) : (
                      <span className="text-xs text-slate-500">No action</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function getLatestEvidencePack(
  store: PersistenceStore,
): Promise<EvidencePack | null> {
  const scanJobs = await store.listScanJobs();
  const latestCompletedScan = scanJobs
    .filter((scanJob) => scanJob.status === "completed")
    .sort((left, right) =>
      compareNullableDates(
        right.completedAt ?? right.startedAt,
        left.completedAt ?? left.startedAt,
      ),
    )[0];
  if (!latestCompletedScan) return null;

  const repository = await store.getRepository(
    latestCompletedScan.repositoryId,
  );
  if (!repository) return null;

  const [findings, decisionMemories, verificationResults, fixProposals] =
    await Promise.all([
      store.listFindings(),
      store.listFixDecisionMemories({ repositoryId: repository.id }),
      store.listVerificationResults(),
      store.listFixProposals(),
    ]);
  const repositoryProposalIds = new Set(
    fixProposals
      .filter((proposal) => proposal.repositoryId === repository.id)
      .map((proposal) => proposal.id),
  );

  return generateEvidencePack({
    repository,
    scanJob: latestCompletedScan,
    findings,
    decisionMemories,
    verificationResults: verificationResults.filter((result) =>
      repositoryProposalIds.has(result.fixProposalId),
    ),
  });
}

function compareNullableDates(
  left: string | null,
  right: string | null,
): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return new Date(left).getTime() - new Date(right).getTime();
}

function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={`rounded-lg border bg-white p-5 shadow-surface ${tone === "warning" ? "border-red-200" : "border-border"}`}
    >
      <div className="text-xs font-medium uppercase text-slate-500">
        {label}
      </div>
      <div
        className={`mt-2 text-2xl font-semibold ${tone === "warning" ? "text-red-700" : "text-slate-950"}`}
      >
        {value}
      </div>
    </div>
  );
}
