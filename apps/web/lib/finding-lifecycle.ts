import { createHash } from "node:crypto";
import type {
  Finding,
  FindingLifecycleSummary,
  FindingLifecycleStatus,
  FindingMemoryStatus,
} from "@autocyber/core";
import type { NormalizedFinding } from "@autocyber/scanner";

export type LifecycleFinding = NormalizedFinding &
  Required<
    Pick<
      Finding,
      | "lifecycleStatus"
      | "firstSeenAt"
      | "lastSeenAt"
      | "resolvedAt"
      | "occurrenceCount"
      | "fingerprint"
      | "previousFindingId"
      | "memoryStatus"
    >
  >;

export interface FindingLifecycleResult {
  currentFindings: LifecycleFinding[];
  resolvedFindings: LifecycleFinding[];
  summary: FindingLifecycleSummary;
}

export interface ClassifyFindingLifecycleInput {
  repositoryId: string;
  scanJobId: string;
  currentFindings: NormalizedFinding[];
  previousFindings: Finding[];
  falsePositiveFingerprints: Set<string>;
  now?: string;
}

export function createFindingFingerprint(
  finding: Pick<
    NormalizedFinding,
    "repositoryId" | "ruleId" | "affectedFile" | "evidence"
  >,
): string {
  const firstEvidence = finding.evidence[0];
  const source = [
    normalizeFingerprintPart(finding.repositoryId),
    normalizeFingerprintPart(finding.ruleId),
    normalizePath(finding.affectedFile),
    normalizeFingerprintPart(firstEvidence?.filePath ?? finding.affectedFile),
    normalizeLocation(firstEvidence?.startLine),
    normalizeLocation(firstEvidence?.endLine),
    normalizeEvidence(firstEvidence?.snippet ?? ""),
  ].join("\0");

  return `fp_${createHash("sha256").update(source).digest("hex").slice(0, 32)}`;
}

export function classifyFindingLifecycle(
  input: ClassifyFindingLifecycleInput,
): FindingLifecycleResult {
  const now = input.now ?? new Date().toISOString();
  const previousForRepository = input.previousFindings.filter(
    (finding) => finding.repositoryId === input.repositoryId,
  );
  const previousByFingerprint = new Map<string, Finding[]>();

  for (const finding of previousForRepository) {
    const fingerprint =
      finding.fingerprint || createFindingFingerprint(finding);
    previousByFingerprint.set(fingerprint, [
      ...(previousByFingerprint.get(fingerprint) ?? []),
      finding,
    ]);
  }

  const currentFingerprints = new Set<string>();
  const currentFindings = input.currentFindings.map<LifecycleFinding>(
    (finding) => {
      const fingerprint =
        finding.fingerprint ?? createFindingFingerprint(finding);
      currentFingerprints.add(fingerprint);
      const previousMatches = previousByFingerprint.get(fingerprint) ?? [];
      const previous = latestFinding(previousMatches);
      const lifecycleStatus: FindingLifecycleStatus = !previous
        ? "new"
        : isResolvedFinding(previous)
          ? "reappeared"
          : "existing";
      const memoryStatus: FindingMemoryStatus =
        input.falsePositiveFingerprints.has(fingerprint)
          ? "false_positive_suppressed"
          : "none";

      return {
        ...finding,
        repositoryId: input.repositoryId,
        scanJobId: input.scanJobId,
        status:
          memoryStatus === "false_positive_suppressed"
            ? "false_positive"
            : finding.status,
        lifecycleStatus,
        firstSeenAt: previous?.firstSeenAt ?? now,
        lastSeenAt: now,
        resolvedAt: null,
        occurrenceCount: (previous?.occurrenceCount ?? 0) + 1,
        fingerprint,
        previousFindingId: previous?.id ?? null,
        memoryStatus,
      };
    },
  );

  const resolvedFindings = Array.from(previousByFingerprint.entries())
    .filter(([fingerprint]) => !currentFingerprints.has(fingerprint))
    .map(([, findings]) => latestFinding(findings))
    .filter(isOpenFinding)
    .map<LifecycleFinding>((finding) => {
      const fingerprint =
        finding.fingerprint || createFindingFingerprint(finding);
      return {
        ...finding,
        id: `${finding.id}:resolved:${input.scanJobId}`,
        scanJobId: input.scanJobId,
        status: "resolved",
        lifecycleStatus: "resolved",
        lastSeenAt: finding.lastSeenAt,
        resolvedAt: now,
        fingerprint,
        previousFindingId: finding.id,
        memoryStatus: finding.memoryStatus ?? "none",
      };
    });

  const allLifecycleFindings = [...currentFindings, ...resolvedFindings];
  return {
    currentFindings,
    resolvedFindings,
    summary: summarizeFindingLifecycle(allLifecycleFindings),
  };
}

export function summarizeFindingLifecycle(
  findings: Array<Partial<Pick<Finding, "lifecycleStatus">>>,
): FindingLifecycleSummary {
  return findings.reduce<FindingLifecycleSummary>(
    (summary, finding) => {
      if (!finding.lifecycleStatus) return summary;
      summary[finding.lifecycleStatus] += 1;
      return summary;
    },
    { new: 0, existing: 0, resolved: 0, reappeared: 0 },
  );
}

export function emptyFindingLifecycleSummary(): FindingLifecycleSummary {
  return { new: 0, existing: 0, resolved: 0, reappeared: 0 };
}

function isResolvedFinding(
  finding: Pick<Finding, "status" | "lifecycleStatus">,
): boolean {
  return (
    finding.status === "resolved" || finding.lifecycleStatus === "resolved"
  );
}

function isOpenFinding(finding: Finding | undefined): finding is Finding {
  if (!finding) return false;
  return !isResolvedFinding(finding);
}

function latestFinding(findings: Finding[]): Finding | undefined {
  return [...findings].sort((first, second) => {
    const firstDate = first.updatedAt ?? first.lastSeenAt ?? first.createdAt;
    const secondDate =
      second.updatedAt ?? second.lastSeenAt ?? second.createdAt;
    return new Date(secondDate).getTime() - new Date(firstDate).getTime();
  })[0];
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
}

function normalizeLocation(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value))
    return "line:unknown";
  return `line:${Math.max(1, Math.floor(value))}`;
}

function normalizeEvidence(value: string): string {
  return normalizeFingerprintPart(redactSensitiveFingerprintInput(value));
}

function normalizeFingerprintPart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function redactSensitiveFingerprintInput(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DB_URL]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_[REDACTED]")
    .replace(/\bgh[opsu]_[A-Za-z0-9_]+\b/g, "gh_[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[REDACTED]")
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    );
}
