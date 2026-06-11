import Link from "next/link";
import type { ReactNode } from "react";
import { GitHubAppSyncButton } from "@/components/github-app-sync-button";
import { PageHeader } from "@/components/page-header";
import { getPersistenceStore } from "@/lib/persistence/store";
import { sortRepositories, type RepositorySortKey } from "@/lib/repository-list";
import { getRepositoryCapabilityBadges, getRepositoryMonitoringStatus, hasRemovedGitHubAppAccess } from "@/lib/repository-monitoring-status";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const statusToneClass = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  muted: "border-slate-200 bg-slate-50 text-slate-600"
};

interface RepositoriesPageProps {
  searchParams?: Promise<{ connected?: string; sort?: string; sync?: string }>;
}

export default async function RepositoriesPage({ searchParams }: RepositoriesPageProps) {
  const store = getPersistenceStore();
  const listSecurityMemories = "listSecurityMemories" in store ? store.listSecurityMemories.bind(store) : async () => [];
  const [repositories, installations, securityMemories] = await Promise.all([
    store.listRepositories(),
    store.listGitHubInstallations(),
    listSecurityMemories()
  ]);
  const params = searchParams ? await searchParams : {};
  const sort = parseRepositorySort(params.sort);
  const sortedRepositories = sortRepositories(repositories, sort);
  const installationsById = new Map(installations.map((installation) => [installation.installationId, installation]));
  const stackSummariesByRepository = getStackSummariesByRepository(securityMemories);
  const githubAppInstallUrl = process.env.GITHUB_APP_INSTALL_URL?.trim();
  const showConnectedBanner = params.connected === "github";

  return (
    <div className="space-y-6">
      <PageHeader title="Repositories" description="Repository records from persistence and monitoring ingestion." />
      {showConnectedBanner ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          GitHub connected successfully. Selected repositories are available for monitoring, and GitHub App PR remediation remains disabled until that path is implemented.
        </div>
      ) : null}
      {params.sync === "github" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          GitHub App repositories synced. Repositories selected in GitHub should now show their latest connection state.
        </div>
      ) : null}
      {params.sync === "failed" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          GitHub App repository sync failed. Check GitHub App credentials and installation access, then try again.
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Link href="/repositories/new" className="inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
          Add repository
        </Link>
        {installations.length > 0 ? (
          <GitHubAppSyncButton />
        ) : null}
        {githubAppInstallUrl ? (
          <a
            href={githubAppInstallUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Connect GitHub App
          </a>
        ) : (
          <span className="inline-flex rounded-md border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
            GitHub App install URL not configured
          </span>
        )}
      </div>
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900">
        GitHub opens in a new tab. To show connected repositories here after installation, configure the GitHub App Setup URL / Callback URL to point at <code className="rounded bg-white px-1 py-0.5">/api/github-app/callback</code> on this AutoCyber URL. If GitHub does not redirect after adding repositories, use sync to refresh selected repo access.
      </section>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-700">Sort by</span>
        <SortLink active={sort === "last_scanned"} href="/repositories?sort=last_scanned">
          Last scanned
        </SortLink>
        <SortLink active={sort === "created_at"} href="/repositories?sort=created_at">
          Added
        </SortLink>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-surface">
        <table className="w-full min-w-[1240px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Repository</th>
              <th className="px-5 py-3">Provider</th>
              <th className="px-5 py-3">Monitoring</th>
              <th className="px-5 py-3">Capabilities</th>
              <th className="px-5 py-3">GitHub App</th>
              <th className="px-5 py-3">Stack</th>
              <th className="px-5 py-3">Default branch</th>
              <th className="px-5 py-3">Last scanned</th>
              <th className="px-5 py-3">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedRepositories.map((repository) => {
              const monitoringStatus = getRepositoryMonitoringStatus(repository);
              const capabilityBadges = getRepositoryCapabilityBadges(repository);
              const installation = repository.installationId ? installationsById.get(repository.installationId) : null;
              const stackSummary = stackSummariesByRepository.get(repository.id);
              const connectionTypeLabel = repository.installationId ? "github app" : repository.connectionType.replaceAll("_", " ");
              const accessRemoved = hasRemovedGitHubAppAccess(repository);
              const repositoryGitHubUrl = getRepositoryGitHubUrl(repository);
              return (
                <tr key={repository.id}>
                  <td className="px-5 py-4 font-medium text-slate-950">
                    {repositoryGitHubUrl ? (
                      <a
                        href={repositoryGitHubUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex text-slate-950 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-950"
                      >
                        {repository.owner}/{repository.name}
                      </a>
                    ) : (
                      <div>{repository.owner}/{repository.name}</div>
                    )}
                    <div className="mt-1 text-xs font-normal text-slate-500">
                      {repository.isPrivate ? "private" : "public"} · {connectionTypeLabel}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-600">{repository.provider}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusToneClass[monitoringStatus.tone]}`}>
                      {monitoringStatus.label}
                    </span>
                    <div className="mt-2 max-w-sm text-xs text-slate-500">{monitoringStatus.detail}</div>
                    {repository.connectionType === "public_github" && !repository.installationId && githubAppInstallUrl ? (
                      <a
                        href={githubAppInstallUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-3 inline-flex text-xs font-semibold text-slate-900 underline"
                      >
                        Enable monitoring with GitHub App
                      </a>
                    ) : null}
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
                  <td className="px-5 py-4 text-slate-600">
                    <div>{repository.installationId ? "installation ID present" : "installation ID missing"}</div>
                    {installation ? (
                      <div className={`mt-1 text-xs ${accessRemoved ? "font-semibold text-amber-800" : "text-slate-500"}`}>
                        {accessRemoved ? "repository access removed" : "repository access connected"}
                      </div>
                    ) : null}
                    {repository.connectionType === "github_app" && !repository.canOpenPr ? (
                      <div className="mt-1 text-xs text-slate-500">GitHub App PR remediation not implemented</div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {stackSummary ? (
                      <div className="max-w-48 text-xs leading-5">{stackSummary}</div>
                    ) : (
                      <span className="text-xs text-slate-400">Not profiled yet</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-600">{repository.defaultBranch}</td>
                  <td className="px-5 py-4 text-slate-600">{formatDateTime(repository.lastScannedAt)}</td>
                  <td className="px-5 py-4 text-slate-600">{formatDateTime(repository.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseRepositorySort(value: string | undefined): RepositorySortKey {
  return value === "created_at" ? "created_at" : "last_scanned";
}

function SortLink({ active, href, children }: { active: boolean; href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex rounded-md border px-3 py-1.5 text-xs font-semibold ${
        active ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-700"
      }`}
    >
      {children}
    </Link>
  );
}

function getRepositoryGitHubUrl(repository: { provider: string; url: string }): string | null {
  if (repository.provider !== "github") return null;

  try {
    const url = new URL(repository.url);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "github.com") return null;
    const [, owner, repo] = url.pathname.split("/");
    if (!owner || !repo) return null;
    return url.toString();
  } catch {
    return null;
  }
}

interface RepoProfileMemory {
  frameworks?: unknown;
  languages?: unknown;
  integrations?: unknown;
  deploymentProviders?: unknown;
  packageManagers?: unknown;
}

function getStackSummariesByRepository(
  memories: Array<{ repositoryId: string; kind: string; content: string }>
): Map<string, string> {
  const summaries = new Map<string, string>();
  for (const memory of memories) {
    if (memory.kind !== "repo_profile") continue;
    const summary = summarizeRepoProfile(memory.content);
    if (summary) summaries.set(memory.repositoryId, summary);
  }
  return summaries;
}

function summarizeRepoProfile(content: string): string | null {
  let profile: RepoProfileMemory;
  try {
    profile = JSON.parse(content) as RepoProfileMemory;
  } catch {
    return null;
  }

  const values = [
    ...stringArray(profile.frameworks),
    ...stringArray(profile.languages),
    ...stringArray(profile.integrations),
    ...stringArray(profile.deploymentProviders),
    ...stringArray(profile.packageManagers)
  ];
  const unique = Array.from(new Set(values)).slice(0, 6);
  return unique.length ? unique.join(", ") : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
