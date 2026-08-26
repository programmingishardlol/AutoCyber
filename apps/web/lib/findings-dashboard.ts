import type { FindingStatus, Severity, StackTag } from "@autocyber/core";
import type { NormalizedFinding } from "@autocyber/scanner";
import { scoreFindingPriority } from "./priority-scoring";
import type { ScanResponse, ScanSource } from "./scanner-service";

export interface FindingFilters {
  severity?: string;
  category?: string;
  stack?: string;
  status?: string;
}

export interface FindingsDashboardState {
  source: ScanSource;
  path: string;
  repoUrl: string;
  response: ScanResponse | null;
  error: { error: string; message: string } | null;
  allFindings: NormalizedFinding[];
  filteredFindings: NormalizedFinding[];
  filters: FindingFilters;
  filterOptions: {
    severities: Severity[];
    categories: string[];
    stacks: StackTag[];
    statuses: FindingStatus[];
  };
}

const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export function sortFindingsForDashboard(
  findings: NormalizedFinding[],
): NormalizedFinding[] {
  return [...findings].sort((left, right) => {
    const priorityDelta = getPriorityScore(right) - getPriorityScore(left);
    if (priorityDelta !== 0) return priorityDelta;
    const severityDelta =
      severityRank[right.severity] - severityRank[left.severity];
    if (severityDelta !== 0) return severityDelta;
    return right.confidence - left.confidence;
  });
}

export function filterFindings(
  findings: NormalizedFinding[],
  filters: FindingFilters,
): NormalizedFinding[] {
  return findings.filter((finding) => {
    if (filters.severity && finding.severity !== filters.severity) return false;
    if (filters.category && finding.category !== filters.category) return false;
    if (filters.stack && !finding.stackTags.includes(filters.stack as StackTag))
      return false;
    if (filters.status && finding.status !== filters.status) return false;
    return true;
  });
}

export function getFindingFilterOptions(findings: NormalizedFinding[]) {
  return {
    severities: unique(findings.map((finding) => finding.severity)).sort(
      (left, right) => severityRank[right] - severityRank[left],
    ),
    categories: unique(findings.map((finding) => finding.category)).sort(),
    stacks: unique(findings.flatMap((finding) => finding.stackTags)).sort(),
    statuses: unique(findings.map((finding) => finding.status)).sort(),
  };
}

export function createFindingDetailKey(finding: NormalizedFinding): string {
  return encodeDetailKey(`${finding.ruleId}\0${finding.affectedFile}`);
}

export function resolveFindingDetail(
  findings: NormalizedFinding[],
  id: string,
): NormalizedFinding | undefined {
  const decodedId = decodeFindingDetailKey(id);
  return findings.find(
    (finding) =>
      finding.id === id ||
      finding.ruleId === id ||
      `${finding.ruleId}\0${finding.affectedFile}` === decodedId,
  );
}

export function createFindingDetailHref(
  finding: NormalizedFinding,
  params: { source: ScanSource; path: string; repoUrl: string },
): string {
  const query = new URLSearchParams();
  query.set("source", params.source);
  if (params.path) query.set("path", params.path);
  if (params.repoUrl) query.set("repoUrl", params.repoUrl);

  return `/findings/${createFindingDetailKey(finding)}?${query.toString()}`;
}

export function createFindingsFilterHref(
  current: FindingsDashboardState,
  updates: FindingFilters,
): string {
  const query = new URLSearchParams();
  query.set("source", current.source);
  if (current.path) query.set("path", current.path);
  if (current.repoUrl) query.set("repoUrl", current.repoUrl);

  const nextFilters = { ...current.filters, ...updates };
  for (const [key, value] of Object.entries(nextFilters)) {
    if (value) query.set(key, value);
  }

  return `/findings?${query.toString()}`;
}

export function formatFilterLabel(value: string): string {
  return value.replaceAll("-", " ").replaceAll("_", " ");
}

function unique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function getPriorityScore(finding: NormalizedFinding): number {
  return finding.priorityScore ?? scoreFindingPriority(finding).priorityScore;
}

function encodeDetailKey(value: string): string {
  return Array.from(value)
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
}

function decodeFindingDetailKey(id: string): string {
  if (!/^[0-9a-f]+$/i.test(id) || id.length % 4 !== 0)
    return decodeURIComponent(id);

  return id
    .match(/.{1,4}/g)!
    .map((chunk) => String.fromCharCode(Number.parseInt(chunk, 16)))
    .join("");
}
