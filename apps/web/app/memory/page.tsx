import { mockSecurityMemories } from "@autocyber/core";
import { PageHeader } from "@/components/page-header";

export default function SecurityMemoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Security memory" description="Repo-specific architecture notes, accepted fixes, rejected fixes, false positives, and team preferences." />
      <div className="grid gap-4 lg:grid-cols-2">
        {mockSecurityMemories.map((memory) => (
          <article key={memory.id} className="rounded-lg border border-border bg-white p-6 shadow-surface">
            <div className="text-xs font-semibold uppercase text-emerald-700">{memory.kind.replaceAll("_", " ")}</div>
            <h2 className="mt-2 font-semibold text-slate-950">{memory.title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{memory.content}</p>
            <p className="mt-5 text-xs font-medium text-slate-500">Source: {memory.source}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
