import { databaseTables, stageZeroSchemaNotes } from "@autocyber/core";
import { PageHeader } from "@/components/page-header";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Auth-ready and database-ready foundation notes for future team, repo, integration token, and audit boundaries." />
      <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
        <h2 className="text-base font-semibold text-slate-950">Stage 0 schema map</h2>
        <div className="mt-5 grid gap-3">
          {databaseTables.map((table) => (
            <div key={table} className="rounded-md border border-border bg-slate-50 p-4">
              <div className="font-mono text-sm font-semibold text-slate-950">{table}</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{stageZeroSchemaNotes[table]}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
