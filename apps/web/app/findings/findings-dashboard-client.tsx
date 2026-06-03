"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { NormalizedFinding } from "@autocyber/scanner";
import { Badge, SeverityBadge, StatusBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import {
  createFindingDetailHref,
  createFindingsFilterHref,
  filterFindings,
  formatFilterLabel,
  getFindingFilterOptions,
  sortFindingsForDashboard,
  type FindingsDashboardState
} from "@/lib/findings-dashboard";
import type { ScanErrorResponse, ScanResponse, ScanSource } from "@/lib/scanner-service";
import { formatPercent } from "@/lib/utils";

interface FindingsDashboardClientProps {
  defaultPath: string;
  initialParams: Record<string, string>;
}

export function FindingsDashboardClient({ defaultPath, initialParams }: FindingsDashboardClientProps) {
  const source: ScanSource = initialParams.source === "github" ? "github" : "local";
  const path = initialParams.path ?? defaultPath;
  const repoUrl = initialParams.repoUrl ?? "";
  const filters = useMemo(
    () => ({
      severity: initialParams.severity,
      category: initialParams.category,
      stack: initialParams.stack,
      status: initialParams.status
    }),
    [initialParams.category, initialParams.severity, initialParams.stack, initialParams.status]
  );
  const [scanState, setScanState] = useState<{
    loading: boolean;
    response: ScanResponse | null;
    error: ScanErrorResponse | null;
  }>({ loading: true, response: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setScanState({ loading: true, response: null, error: null });

    fetch("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(source === "github" ? { source, repoUrl } : { source, path }),
      signal: controller.signal
    })
      .then(async (response) => {
        const body = (await response.json()) as ScanResponse | ScanErrorResponse;
        if ("error" in body) {
          setScanState({ loading: false, response: null, error: body });
          return;
        }

        setScanState({ loading: false, response: body, error: null });
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return;
        setScanState({
          loading: false,
          response: null,
          error: { error: "scan failed", message: "The findings dashboard could not load scanner output." }
        });
      });

    return () => controller.abort();
  }, [source, path, repoUrl]);

  const allFindings = useMemo(() => sortFindingsForDashboard(scanState.response?.findings ?? []), [scanState.response]);
  const filteredFindings = useMemo(() => filterFindings(allFindings, filters), [allFindings, filters]);
  const filterOptions = useMemo(() => getFindingFilterOptions(allFindings), [allFindings]);
  const state: FindingsDashboardState = {
    source,
    path,
    repoUrl,
    response: scanState.response,
    error: scanState.error,
    allFindings,
    filteredFindings,
    filters,
    filterOptions
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Findings"
        description="Security findings from the Stage 1 scanner, ranked for triage with evidence, confidence, and remediation readiness."
      />

      <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
        <form className="grid gap-4 lg:grid-cols-[150px_1fr_1fr_auto]">
          <label className="text-sm font-medium text-slate-700">
            Source
            <select name="source" defaultValue={source} className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm">
              <option value="local">Local path</option>
              <option value="github">GitHub URL</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Local path
            <input name="path" defaultValue={path} placeholder={defaultPath} className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm" />
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
              Load findings
            </button>
          </div>
        </form>
      </section>

      {scanState.loading ? <LoadingState /> : null}

      {scanState.error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="font-semibold text-red-900">{scanState.error.error}</h2>
          <p className="mt-2 text-sm text-red-700">{scanState.error.message}</p>
        </section>
      ) : null}

      {scanState.response ? (
        <section className="grid gap-3 md:grid-cols-4">
          <SummaryCard label="Scan status" value={scanState.response.scanJob.status} />
          <SummaryCard label="Files scanned" value={String(scanState.response.result?.filesScanned ?? 0)} />
          <SummaryCard label="Findings" value={String(allFindings.length)} />
          <SummaryCard label="Filtered" value={String(filteredFindings.length)} />
        </section>
      ) : null}

      {!scanState.loading ? (
        <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
          <form>
            <input type="hidden" name="source" value={source} />
            {path ? <input type="hidden" name="path" value={path} /> : null}
            {repoUrl ? <input type="hidden" name="repoUrl" value={repoUrl} /> : null}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">Triage filters</h2>
                <p className="mt-1 text-sm text-slate-600">Filter by scanner fields without changing the underlying scan result.</p>
              </div>
              <div className="flex items-center gap-3">
                <Link href={createFindingsFilterHref(state, { severity: "", category: "", stack: "", status: "" })} className="text-sm font-semibold text-slate-700">
                  Clear filters
                </Link>
                <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white" type="submit">
                  Apply filters
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-4">
              <FilterSelect label="Severity" name="severity" value={filters.severity} options={filterOptions.severities} />
              <FilterSelect label="Category" name="category" value={filters.category} options={filterOptions.categories} />
              <FilterSelect label="Stack" name="stack" value={filters.stack} options={filterOptions.stacks} />
              <FilterSelect label="Status" name="status" value={filters.status} options={filterOptions.statuses} />
            </div>
          </form>
        </section>
      ) : null}

      {allFindings.length === 0 && !scanState.loading && !scanState.error ? (
        <EmptyState
          title="No findings returned"
          description="The scanner did not return open findings for this source. For local testing, use the insecure Stage 1 fixture path shown in the input placeholder."
        />
      ) : null}

      {allFindings.length > 0 && filteredFindings.length === 0 ? (
        <EmptyState title="No findings match these filters" description="Clear one or more filters to return to the full scanner result." />
      ) : null}

      {filteredFindings.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-white shadow-surface">
          <div className="divide-y divide-border">
            {filteredFindings.map((finding) => (
              <FindingListItem key={`${finding.ruleId}-${finding.affectedFile}`} finding={finding} source={source} path={path} repoUrl={repoUrl} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FindingListItem({ finding, source, path, repoUrl }: { finding: NormalizedFinding; source: ScanSource; path: string; repoUrl: string }) {
  return (
    <Link href={createFindingDetailHref(finding, { source, path, repoUrl })} className="block p-5 hover:bg-slate-50">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <StatusBadge status={finding.status} />
            <Badge>{formatFilterLabel(finding.category)}</Badge>
            {finding.stackTags.map((tag) => (
              <Badge key={tag} tone="blue">{tag}</Badge>
            ))}
          </div>
          <h2 className="mt-3 font-semibold text-slate-950">{finding.title}</h2>
          <p className="mt-2 break-words font-mono text-sm text-slate-600">{finding.affectedFile}</p>
          <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{finding.riskExplanation}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className="rounded-md border border-border bg-slate-50 px-2 py-1 font-medium">{formatPercent(finding.confidence)} confidence</span>
          <Badge tone={finding.autofixAvailable ? "green" : "gray"}>{finding.autofixAvailable ? "Autofix available" : "Manual fix"}</Badge>
        </div>
      </div>
    </Link>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 shadow-surface">
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold capitalize text-slate-950">{value}</div>
    </div>
  );
}

function FilterSelect({ label, name, value, options }: { label: string; name: "severity" | "category" | "stack" | "status"; value?: string; options: string[] }) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <select name={name} defaultValue={value ?? ""} className="mt-2 w-full rounded-md border border-border bg-white px-3 py-2 text-sm">
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatFilterLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function LoadingState() {
  return (
    <section className="rounded-lg border border-border bg-white p-6 shadow-surface">
      <div className="h-5 w-44 animate-pulse rounded-md bg-slate-200" />
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-20 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    </section>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-lg border border-dashed border-border bg-white p-8 text-center">
      <h2 className="font-semibold text-slate-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
    </section>
  );
}
