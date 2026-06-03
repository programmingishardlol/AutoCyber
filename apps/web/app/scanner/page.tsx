import { resolve } from "node:path";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { SeverityBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { createFindingDetailHref } from "@/lib/findings-dashboard";
import { runScan, type ScanResponse } from "@/lib/scanner-service";

type SearchParams = Promise<{
  source?: string;
  path?: string;
  repoUrl?: string;
}>;

const defaultFixturePath = resolve(process.cwd(), "../../packages/scanner/src/fixtures/insecure-startup-app");

export default async function ScannerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const source = params.source === "github" ? "github" : "local";
  const path = params.path ?? "";
  const repoUrl = params.repoUrl ?? "";
  const shouldRun = Boolean(path || repoUrl);
  const scan = shouldRun ? await runScan({ source, path, repoUrl }) : null;
  const body = scan?.body;
  const response = body && "scanJob" in body ? (body as ScanResponse) : null;
  const error = body && "error" in body ? body : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repo scanner"
        description="Run the scanner against a local development path or a public GitHub repository URL. Private GitHub scans require the future GitHub App flow."
      />

      <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
        <form className="grid gap-4 lg:grid-cols-[160px_1fr_1fr_auto]">
          <label className="text-sm font-medium text-slate-700">
            Source
            <select name="source" defaultValue={source} className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm">
              <option value="local">Local path</option>
              <option value="github">GitHub URL</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Local path
            <input
              name="path"
              defaultValue={path}
              placeholder={defaultFixturePath}
              className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            GitHub URL
            <input
              name="repoUrl"
              defaultValue={repoUrl}
              placeholder="https://github.com/acme/app"
              className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">
              Run scan
            </button>
          </div>
        </form>
      </section>

      {!shouldRun ? (
        <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <h2 className="font-semibold text-slate-950">Development fixture</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Use this local path to exercise the real scanner output:</p>
          <code className="mt-3 block overflow-x-auto rounded-md bg-slate-950 p-4 text-sm text-slate-100">{defaultFixturePath}</code>
        </section>
      ) : null}

      {error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="font-semibold text-red-900">{error.error}</h2>
          <p className="mt-2 text-sm text-red-700">{error.message}</p>
        </section>
      ) : null}

      {response ? (
        <section className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-6 shadow-surface">
            <h2 className="font-semibold text-slate-950">Scan result</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border bg-slate-50 p-4">
                <div className="text-xs font-medium uppercase text-slate-500">Status</div>
                <div className="mt-1 font-semibold text-slate-950">{response.scanJob.status}</div>
              </div>
              <div className="rounded-md border border-border bg-slate-50 p-4">
                <div className="text-xs font-medium uppercase text-slate-500">Findings</div>
                <div className="mt-1 font-semibold text-slate-950">{response.findings.length}</div>
              </div>
              <div className="rounded-md border border-border bg-slate-50 p-4">
                <div className="text-xs font-medium uppercase text-slate-500">Frameworks</div>
                <div className="mt-1 font-semibold text-slate-950">{response.projectProfile?.frameworks.join(", ") || "Pending"}</div>
              </div>
            </div>
          </div>

          {response.findings.map((finding) => (
            <Link
              key={finding.id}
              href={createFindingDetailHref(finding, { source, path, repoUrl })}
              className="block rounded-lg border border-border bg-white p-6 shadow-surface transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-950">{finding.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{finding.affectedFile}</p>
                </div>
                <SeverityBadge severity={finding.severity} />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{finding.riskExplanation}</p>
              <pre className="mt-4 overflow-x-auto rounded-md bg-slate-950 p-4 text-sm text-slate-100">{finding.evidence[0]?.snippet}</pre>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-slate-800">
                Open finding detail
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
