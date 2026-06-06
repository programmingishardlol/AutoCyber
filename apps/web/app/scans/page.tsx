import { StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getMonitoringHistory, summarizeMonitoringHistory } from "@/lib/monitoring-history";
import { getPersistenceStore } from "@/lib/persistence/store";
import { formatDateTime } from "@/lib/utils";
import { RetryScanButton } from "./retry-scan-button";

export const dynamic = "force-dynamic";

const sourceLabels = {
  manual: "Manual",
  push: "Push",
  pull_request: "Pull request",
  scheduled: "Scheduled"
};

export default async function ScansPage() {
  const history = await getMonitoringHistory(getPersistenceStore());
  const summary = summarizeMonitoringHistory(history);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring history"
        description="Continuous monitoring scan jobs from manual scans, GitHub push events, and pull request events."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryStat label="Latest status" value={summary.latestStatus?.replaceAll("_", " ") ?? "No scans"} />
        <SummaryStat label="Total scans" value={String(summary.total)} />
        <SummaryStat label="Completed" value={String(summary.byStatus.completed)} />
        <SummaryStat label="Failed" value={String(summary.byStatus.failed)} tone={summary.hasFailures ? "warning" : "default"} />
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-sm text-slate-600">
          No monitoring scans have been recorded yet. Connect a GitHub repository and send a signed webhook event to create queued scans.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-surface">
          <table className="w-full min-w-[1040px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[17%]" />
              <col className="w-[6%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Repository</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Commit</th>
                <th className="px-4 py-3">PR</th>
                <th className="px-4 py-3">Findings</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((scan) => (
                <tr key={scan.id}>
                  <td className="px-4 py-4 align-top">
                    <div className="break-words font-medium text-slate-950">{scan.repositoryName}</div>
                    {scan.webhookDeliveryId ? <div className="mt-1 break-all text-xs text-slate-500">Delivery {scan.webhookDeliveryId}</div> : null}
                    {scan.error ? <div className="mt-2 max-w-md text-xs font-medium text-red-700">{scan.error}</div> : null}
                  </td>
                  <td className="px-4 py-4 align-top"><StatusBadge status={scan.status} /></td>
                  <td className="px-4 py-4 align-top text-slate-600">{sourceLabels[scan.source]}</td>
                  <td className="break-words px-4 py-4 align-top text-slate-600">{scan.branch}</td>
                  <td className="break-all px-4 py-4 align-top font-mono text-xs text-slate-600">{scan.commitSha}</td>
                  <td className="px-4 py-4 align-top text-slate-600">{scan.pullRequestNumber ? `#${scan.pullRequestNumber}` : "None"}</td>
                  <td className="px-4 py-4 align-top text-slate-600">{scan.findingCount}</td>
                  <td className="px-4 py-4 align-top text-slate-600">{formatDateTime(scan.completedAt)}</td>
                  <td className="px-4 py-4 align-top">
                    {scan.status === "failed" ? <RetryScanButton scanJobId={scan.id} /> : <span className="text-xs text-slate-500">No action</span>}
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

function SummaryStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" }) {
  return (
    <div className={`rounded-lg border bg-white p-5 shadow-surface ${tone === "warning" ? "border-red-200" : "border-border"}`}>
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${tone === "warning" ? "text-red-700" : "text-slate-950"}`}>{value}</div>
    </div>
  );
}
