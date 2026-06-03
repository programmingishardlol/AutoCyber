import { mockScanJobs } from "@autocyber/core";
import { StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/utils";

export default function ScansPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Scans" description="Historical mock scan jobs with normalized summary counts." />
      <div className="grid gap-4">
        {mockScanJobs.map((scan) => (
          <article key={scan.id} className="rounded-lg border border-border bg-white p-6 shadow-surface">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">{scan.branch}@{scan.commitSha}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {scan.source} scan completed {formatDateTime(scan.completedAt)}
                </p>
              </div>
              <StatusBadge status={scan.status} />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-5">
              {Object.entries(scan.summary).map(([severity, count]) => (
                <div key={severity} className="rounded-md border border-border bg-slate-50 p-3">
                  <div className="text-xs font-medium uppercase text-slate-500">{severity}</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">{count}</div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
