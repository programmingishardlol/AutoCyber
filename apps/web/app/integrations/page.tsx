import { mockIntegrations } from "@autocyber/core";
import Link from "next/link";
import { Badge, StatusBadge } from "@/components/badge";
import { GitHubAppSyncButton } from "@/components/github-app-sync-button";
import { PageHeader } from "@/components/page-header";
import { getIntegrationCapability } from "@/lib/integration-capabilities";
import { getPersistenceStore } from "@/lib/persistence/store";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const githubInstallations = await getPersistenceStore().listGitHubInstallations();
  const githubAppInstallUrl = process.env.GITHUB_APP_INSTALL_URL?.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Startup-stack scanner coverage and repository connection states for monitoring."
      />
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-5 text-sm leading-6 text-sky-900">
        Public GitHub URLs can be scanned one time without a token. Continuous monitoring and private repository scans require the GitHub App. GitHub App PR remediation is not implemented yet; token-dev mode is only for local testing.
      </section>
      <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-950">GitHub App connection</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {githubInstallations.length} {githubInstallations.length === 1 ? "installation" : "installations"} connected. Selected repositories are stored separately from installation-level permissions.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {githubInstallations.length > 0 ? (
              <GitHubAppSyncButton />
            ) : null}
            {githubAppInstallUrl ? (
              <a
                href={githubAppInstallUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
              >
                Install AutoCyber GitHub App
              </a>
            ) : (
              <span className="inline-flex rounded-md border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
                GitHub App install URL not configured
              </span>
            )}
          </div>
        </div>
        {githubInstallations.length > 0 ? (
          <p className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
            If a repository was added in GitHub but still looks disconnected here, sync selected repositories to refresh AutoCyber from the GitHub App installation.
          </p>
        ) : null}
        <Link href="/repositories" className="mt-4 inline-flex text-sm font-semibold text-slate-900 underline">
          View repository capabilities
        </Link>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        {mockIntegrations.map((integration) => {
          const capability = getIntegrationCapability(integration.provider);

          return (
            <article key={integration.id} className="rounded-lg border border-border bg-white p-6 shadow-surface">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-950">{integration.displayName}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{integration.description}</p>
                </div>
                <Badge tone={capability.tone}>{capability.label}</Badge>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                <span>Live provider connection:</span>
                <StatusBadge status={integration.status} />
              </div>
              <p className="mt-3 text-xs font-medium text-slate-500">Last checked: {formatDateTime(integration.lastCheckedAt)}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
