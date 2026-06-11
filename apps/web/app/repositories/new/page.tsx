import { Github, HardDrive, Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export default async function NewRepositoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ githubApp?: string }>;
}) {
  const githubAppInstallUrl = process.env.GITHUB_APP_INSTALL_URL?.trim();
  const resolvedSearchParams = await searchParams;
  const githubAppConnected = resolvedSearchParams?.githubApp === "connected";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add repository"
        description="Choose the connection model AutoCyber can safely use for one-time scans, continuous monitoring, and future remediation permissions."
      />

      {githubAppConnected ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm leading-6 text-emerald-900">
          <h2 className="font-semibold text-emerald-950">GitHub App connected</h2>
          <p className="mt-2">
            Repositories selected during installation can now be scanned and monitored. Connected repositories appear on the repositories page.
          </p>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <div className="flex items-center gap-3">
            <HardDrive className="h-5 w-5 text-slate-700" aria-hidden="true" />
            <h2 className="font-semibold text-slate-950">Local path</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">Use a local clone or development fixture. AutoCyber scans files only and does not execute repo code.</p>
          <form action="/scanner" className="mt-5 space-y-3">
            <input type="hidden" name="source" value="local" />
            <label className="block text-sm font-medium text-slate-700">
              Repository path
              <input
                name="path"
                placeholder="/private/tmp/autocyber-demo"
                className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </label>
            <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">
              Scan local path
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <div className="flex items-center gap-3">
            <Github className="h-5 w-5 text-slate-700" aria-hidden="true" />
            <h2 className="font-semibold text-slate-950">Public GitHub URL</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Run a one-time scan of a public repository without a token. Continuous monitoring and PR remediation stay disabled until GitHub is connected.
          </p>
          <form action="/scanner" className="mt-5 space-y-3">
            <input type="hidden" name="source" value="github" />
            <label className="block text-sm font-medium text-slate-700">
              GitHub URL
              <input
                name="repoUrl"
                placeholder="https://github.com/owner/repo"
                className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </label>
            <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">
              Scan public repo
            </button>
          </form>
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            Public URL scans are read-only and one-time. AutoCyber cannot monitor pushes, scan private repos, or open remediation PRs from this connection type.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 text-slate-700" aria-hidden="true" />
            <h2 className="font-semibold text-slate-950">GitHub App</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Install AutoCyber on selected repositories to enable private repo scanning and continuous monitoring. GitHub App PR remediation is not implemented yet.
          </p>
          {githubAppInstallUrl ? (
            <a
              href={githubAppInstallUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-5 inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
            >
              Install AutoCyber GitHub App
            </a>
          ) : (
            <div className="mt-5 inline-flex rounded-md border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
              GitHub App install URL not configured
            </div>
          )}
          {githubAppInstallUrl ? (
            <p className="mt-3 text-xs leading-5 text-slate-500">
              GitHub opens in a new tab. After installation, AutoCyber will show the connected repositories.
            </p>
          ) : null}
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Requested access is used server-side for repository contents, pull request metadata, and push/pull request webhooks. AutoCyber stores repository metadata, permissions, and capability flags, never the short-lived installation token.
          </p>
          <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
            For connected repositories to appear here, the GitHub App Setup URL / Callback URL must point to <code className="rounded bg-white px-1 py-0.5">/api/github-app/callback</code> on this AutoCyber URL.
          </p>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
        <h2 className="font-semibold text-slate-950">Developer token mode</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Token-dev mode remains a local testing path for verified PR creation. It is not the production GitHub App remediation path, and it should not be used as customer onboarding.
        </p>
      </section>
    </div>
  );
}
