import { mockIntegrations } from "@autocyber/core";
import { Badge, StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { getIntegrationCapability } from "@/lib/integration-capabilities";
import { formatDateTime } from "@/lib/utils";

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Stage 5 startup-stack coverage. Scanner checks and local token prototypes are shown separately from live provider connections."
      />
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-5 text-sm leading-6 text-sky-900">
        Live provider OAuth connections and GitHub App installation are not implemented yet. Available scanner checks run against local repository input.
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
