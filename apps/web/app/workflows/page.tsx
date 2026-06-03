import { mockWorkflowPlaybooks } from "@autocyber/core";
import { PageHeader } from "@/components/page-header";

export default function WorkflowsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Workflows" description="Opinionated security playbooks that will connect detection logic, fix strategy, verification, PR format, and memory updates." />
      <div className="grid gap-4">
        {mockWorkflowPlaybooks.map((playbook) => (
          <article key={playbook.id} className="rounded-lg border border-border bg-white p-6 shadow-surface">
            <h2 className="text-lg font-semibold text-slate-950">{playbook.name}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{playbook.description}</p>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <div className="rounded-md border border-border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-950">Detection</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{playbook.detectionLogic}</p>
              </div>
              <div className="rounded-md border border-border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-950">Fix strategy</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{playbook.fixStrategy}</p>
              </div>
              <div className="rounded-md border border-border bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-950">Verification</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{playbook.verificationCheck}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
