import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getPersistenceStore } from "@/lib/persistence/store";
import { sortRepositoriesByLastScanned } from "@/lib/repository-list";
import { getRepositoryCapabilityBadges, getRepositoryMonitoringStatus } from "@/lib/repository-monitoring-status";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const statusToneClass = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  muted: "border-slate-200 bg-slate-50 text-slate-600"
};

export default async function RepositoriesPage() {
  const repositories = sortRepositoriesByLastScanned(await getPersistenceStore().listRepositories());

  return (
    <div className="space-y-6">
      <PageHeader title="Repositories" description="Repository records from persistence and monitoring ingestion." />
      <Link href="/repositories/new" className="inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
        Add repository
      </Link>
      <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-surface">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Repository</th>
              <th className="px-5 py-3">Provider</th>
              <th className="px-5 py-3">Monitoring</th>
              <th className="px-5 py-3">Capabilities</th>
              <th className="px-5 py-3">GitHub App</th>
              <th className="px-5 py-3">Default branch</th>
              <th className="px-5 py-3">Last scanned</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {repositories.map((repository) => {
              const monitoringStatus = getRepositoryMonitoringStatus(repository);
              const capabilityBadges = getRepositoryCapabilityBadges(repository);
              return (
                <tr key={repository.id}>
                  <td className="px-5 py-4 font-medium text-slate-950">
                    <div>{repository.owner}/{repository.name}</div>
                    <div className="mt-1 text-xs font-normal text-slate-500">
                      {repository.isPrivate ? "private" : "public"} · {repository.connectionType.replaceAll("_", " ")}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{repository.provider}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusToneClass[monitoringStatus.tone]}`}>
                      {monitoringStatus.label}
                    </span>
                    <div className="mt-2 max-w-sm text-xs text-slate-500">{monitoringStatus.detail}</div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex max-w-sm flex-wrap gap-2">
                      {capabilityBadges.map((badge) => (
                        <span key={badge.label} className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusToneClass[badge.tone]}`}>
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{repository.installationId ? "installation ID present" : "installation ID missing"}</td>
                  <td className="px-5 py-4 text-slate-600">{repository.defaultBranch}</td>
                  <td className="px-5 py-4 text-slate-600">{formatDateTime(repository.lastScannedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
