import { mockPullRequests } from "@autocyber/core";
import { StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";

export default function PullRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Pull requests" description="Draft PR metadata for remediation work. Real GitHub branch and PR creation starts after human approval in Stage 4." />
      <div className="grid gap-4">
        {mockPullRequests.map((pullRequest) => (
          <article key={pullRequest.id} className="rounded-lg border border-border bg-white p-6 shadow-surface">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">{pullRequest.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{pullRequest.branchName}</p>
              </div>
              <StatusBadge status={pullRequest.status} />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">{pullRequest.summary}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
