import { mockVerificationResults } from "@autocyber/core";
import { StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";

export default function VerificationPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Verification results" description="Scanner rerun and test evidence records. Stage 0 models the workflow without executing fixes." />
      <div className="grid gap-4">
        {mockVerificationResults.map((result) => (
          <article key={result.id} className="rounded-lg border border-border bg-white p-6 shadow-surface">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">{result.testCommand}</h2>
                <p className="mt-1 text-sm text-slate-600">{result.testOutputSummary}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={result.status} />
                <StatusBadge status={result.scannerRerunStatus} />
              </div>
            </div>
            <div className="mt-5 rounded-md border border-border bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              {result.evidence.join(" ")}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
