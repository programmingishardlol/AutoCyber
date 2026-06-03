import { mockFixProposals } from "@autocyber/core";
import { StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";

export default function FixProposalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Fix proposals" description="Human-reviewable remediation plans with risk notes, verification plans, and diff previews." />
      <div className="grid gap-4">
        {mockFixProposals.map((proposal) => (
          <article key={proposal.id} className="rounded-lg border border-border bg-white p-6 shadow-surface">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{proposal.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{proposal.explanation}</p>
              </div>
              <StatusBadge status={proposal.status} />
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-950">Risk of fix</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{proposal.risk}</p>
              </div>
              <div className="rounded-md border border-border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-950">Verification plan</div>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">
                  {proposal.verificationPlan.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            </div>
            <pre className="mt-5 overflow-x-auto rounded-md bg-slate-950 p-4 text-sm text-slate-100">{proposal.diff}</pre>
          </article>
        ))}
      </div>
    </div>
  );
}
