import { CheckCircle2, FileWarning, GitBranch, Puzzle } from "lucide-react";
import Link from "next/link";
import { CORE_LOOP, mockDashboardSummary, mockFindings, mockProjects, mockScanJobs } from "@autocyber/core";
import { PageHeader } from "@/components/page-header";
import { SeverityBadge, StatusBadge } from "@/components/badge";
import { StatCard } from "@/components/stat-card";
import { formatPercent } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Security remediation workspace"
        description="Detect, explain, fix, verify, and remember security issues across startup stacks."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open findings" value={mockDashboardSummary.openFindings} detail="Prioritized by severity and confidence." icon={FileWarning} />
        <StatCard label="Verified fixes" value={mockDashboardSummary.verifiedFixes} detail="Verification evidence will appear after fixes are approved." icon={CheckCircle2} />
        <StatCard label="Repositories" value={mockDashboardSummary.connectedRepositories} detail="Connected repository records, not live GitHub sync yet." icon={GitBranch} />
        <StatCard label="Integration alerts" value={mockDashboardSummary.integrationsNeedingAttention} detail="Live provider connections are not configured yet." icon={Puzzle} />
      </section>

      <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
        <h2 className="text-base font-semibold text-slate-950">Product loop</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {CORE_LOOP.map((step, index) => (
            <div key={step} className="rounded-md border border-border bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-500">Step {index + 1}</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{step}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-lg border border-border bg-white shadow-surface">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-slate-950">Top findings</h2>
          </div>
          <div className="divide-y divide-border">
            {mockFindings.map((finding) => (
              <Link key={finding.id} href={`/findings/${finding.id}`} className="block px-6 py-4 hover:bg-slate-50">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium text-slate-950">{finding.title}</div>
                    <div className="mt-1 text-sm text-slate-600">{finding.affectedFile}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <StatusBadge status={finding.status} />
                    <span className="text-xs font-medium text-slate-500">{formatPercent(finding.confidence)} confidence</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <h2 className="text-base font-semibold text-slate-950">Recent scans</h2>
          <div className="mt-4 space-y-4">
            {mockScanJobs.map((scan) => {
              const repository = mockProjects.find((project) => project.id === "proj_launchpad");
              return (
                <div key={scan.id} className="rounded-md border border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-slate-950">{scan.branch}@{scan.commitSha}</div>
                    <StatusBadge status={scan.status} />
                  </div>
                  <div className="mt-2 text-sm text-slate-600">{repository?.name ?? "Repository scan"}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
