import { Github, HardDrive, Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export default function NewRepositoryPage() {
  const githubAppInstallUrl = process.env.GITHUB_APP_INSTALL_URL?.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add repository"
        description="Connect a repository with the right access level for scanning, monitoring, and remediation PRs."
      />

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
            Scan a public repository without connecting GitHub. This grants read-only scan capability, not remediation PR access.
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
            PR remediation is disabled for public URL scans until GitHub is connected with contents and pull request write permissions.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 text-slate-700" aria-hidden="true" />
            <h2 className="font-semibold text-slate-950">GitHub App</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Install AutoCyber on selected repositories to enable private repo monitoring and PR remediation when the app has write permissions.
          </p>
          {githubAppInstallUrl ? (
            <a href={githubAppInstallUrl} className="mt-5 inline-flex rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
              Install AutoCyber GitHub App
            </a>
          ) : (
            <div className="mt-5 inline-flex rounded-md border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
              GitHub App install URL not configured
            </div>
          )}
          <p className="mt-4 text-xs leading-5 text-slate-500">
            GitHub redirects back with an installation ID. AutoCyber stores repository metadata and capability flags, never the short-lived installation token.
          </p>
        </section>
      </div>
    </div>
  );
}
