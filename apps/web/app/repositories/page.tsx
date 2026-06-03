import { mockRepositories } from "@autocyber/core";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/utils";

export default function RepositoriesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Repositories" description="Repository records from mock data and Stage 5D scan ingestion." />
      <Link href="/repositories/new" className="inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
        Add repository
      </Link>
      <div className="overflow-hidden rounded-lg border border-border bg-white shadow-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Repository</th>
              <th className="px-5 py-3">Provider</th>
              <th className="px-5 py-3">Default branch</th>
              <th className="px-5 py-3">Last scanned</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {mockRepositories.map((repository) => (
              <tr key={repository.id}>
                <td className="px-5 py-4 font-medium text-slate-950">{repository.owner}/{repository.name}</td>
                <td className="px-5 py-4 text-slate-600">{repository.provider}</td>
                <td className="px-5 py-4 text-slate-600">{repository.defaultBranch}</td>
                <td className="px-5 py-4 text-slate-600">{formatDateTime(repository.lastScannedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
