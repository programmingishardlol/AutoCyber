import { Github, HardDrive, Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export default function NewRepositoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Add repository"
        description="Stage 5D repository onboarding for local development paths and public GitHub URL scans."
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
          <p className="mt-3 text-sm leading-6 text-slate-600">Clone a public repository into the scanner workdir, scan the temporary copy, then delete it.</p>
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
        </section>

        <section className="rounded-lg border border-dashed border-border bg-slate-50 p-6">
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 text-slate-500" aria-hidden="true" />
            <h2 className="font-semibold text-slate-950">Private GitHub</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Private GitHub URL scans and GitHub App installation are coming in Stage 6. Stage 5D only supports public URL scans.
          </p>
        </section>
      </div>
    </div>
  );
}
