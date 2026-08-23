import type {
  Finding,
  FixDecisionMemory,
  Repository,
  ScanJob,
  VerificationResult,
} from "@autocyber/core";
import {
  rankFindingsByPriority,
  type FindingPriority,
  formatPriorityBand,
} from "./priority-scoring";

export interface EvidencePackInput {
  repository: Repository;
  scanJob: ScanJob;
  findings: Finding[];
  decisionMemories: FixDecisionMemory[];
  verificationResults: VerificationResult[];
}

export interface EvidencePackSummary {
  totalFindings: number;
  newFindings: number;
  existingFindings: number;
  resolvedFindings: number;
  reappearedFindings: number;
  falsePositiveSuppressedFindings: number;
}

export interface EvidencePackTopRisk extends FindingPriority {
  title: string;
  ruleId: string;
  severity: Finding["severity"];
  lifecycleStatus: Finding["lifecycleStatus"];
  affectedFile: string;
}

export interface EvidencePack {
  repositoryName: string;
  scanId: string;
  scanSource: string;
  scanTimestamp: string;
  summary: EvidencePackSummary;
  topActiveRisks: EvidencePackTopRisk[];
  acceptedFixHistoryCount: number;
  rejectedManualDecisionCount: number;
  remediationsAppliedCount: number;
  verificationSummary: string;
  knownLimitations: string[];
  nextRecommendedActions: string[];
  markdown: string;
}

export function generateEvidencePack(input: EvidencePackInput): EvidencePack {
  const scopedFindings = input.findings.filter(
    (finding) =>
      finding.repositoryId === input.repository.id &&
      finding.scanJobId === input.scanJob.id,
  );
  const scopedMemories = input.decisionMemories.filter(
    (memory) => memory.repositoryId === input.repository.id,
  );
  const summary = summarizeEvidenceFindings(scopedFindings);
  const ranked = rankFindingsByPriority(scopedFindings, {
    decisionMemories: scopedMemories,
  });
  const topActiveRisks = ranked
    .filter(
      (item) =>
        item.finding.lifecycleStatus !== "resolved" &&
        item.finding.memoryStatus !== "false_positive_suppressed",
    )
    .slice(0, 5)
    .map<EvidencePackTopRisk>((item) => ({
      title: redactEvidenceText(item.finding.title),
      ruleId: item.finding.ruleId,
      severity: item.finding.severity,
      lifecycleStatus: item.finding.lifecycleStatus,
      affectedFile: sanitizeEvidencePath(item.finding.affectedFile),
      ...item.priority,
    }));
  const acceptedFixHistoryCount = scopedMemories.filter(
    (memory) => memory.decisionType === "fix_accepted",
  ).length;
  const rejectedManualDecisionCount = scopedMemories.filter(
    (memory) =>
      memory.decisionType === "fix_rejected" ||
      memory.decisionType === "manual_fix_preferred",
  ).length;
  const remediationsAppliedCount = scopedMemories.filter(
    (memory) => memory.decisionType === "remediation_applied",
  ).length;
  const verificationSummary = summarizeVerification(input.verificationResults);
  const knownLimitations = [
    "Evidence pack is generated from persisted scanner findings and security memory.",
    "AutoCyber does not claim full security coverage.",
    "Manual review is still required before applying remediation.",
  ];
  const nextRecommendedActions = buildNextActions(
    topActiveRisks,
    summary,
    scopedMemories,
  );
  const repositoryName =
    input.repository.provider === "github"
      ? `${input.repository.owner}/${input.repository.name}`
      : input.repository.name;
  const scanSource = formatScanSource(input.scanJob.source, input.repository);
  const scanTimestamp =
    input.scanJob.completedAt ?? input.scanJob.startedAt ?? "Not completed";
  const pack: Omit<EvidencePack, "markdown"> = {
    repositoryName,
    scanId: input.scanJob.id,
    scanSource,
    scanTimestamp,
    summary,
    topActiveRisks,
    acceptedFixHistoryCount,
    rejectedManualDecisionCount,
    remediationsAppliedCount,
    verificationSummary,
    knownLimitations,
    nextRecommendedActions,
  };

  return {
    ...pack,
    markdown: redactEvidenceText(renderMarkdown(pack, scopedMemories)),
  };
}

export function redactEvidenceText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DB_URL]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_[REDACTED]")
    .replace(/\bgh[opsu]_[A-Za-z0-9_]+\b/g, "gh_[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[REDACTED]")
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(/\/private\/tmp\/[^\s)`]+/g, "[LOCAL_TEMP_PATH]")
    .replace(/\/tmp\/[^\s)`]+/g, "[LOCAL_TEMP_PATH]");
}

export function sanitizeEvidencePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const tempIndex = normalized.includes("/private/tmp/")
    ? normalized.indexOf("/private/tmp/")
    : normalized.indexOf("/tmp/");
  if (tempIndex >= 0) {
    const marker = normalized.includes("/.env")
      ? ".env"
      : normalized.split("/").filter(Boolean).slice(-3).join("/");
    return marker || "[LOCAL_TEMP_PATH]";
  }
  return redactEvidenceText(normalized);
}

function summarizeEvidenceFindings(findings: Finding[]): EvidencePackSummary {
  return findings.reduce<EvidencePackSummary>(
    (summary, finding) => {
      summary.totalFindings += 1;
      if (finding.lifecycleStatus === "new") summary.newFindings += 1;
      if (finding.lifecycleStatus === "existing") summary.existingFindings += 1;
      if (finding.lifecycleStatus === "resolved") summary.resolvedFindings += 1;
      if (finding.lifecycleStatus === "reappeared")
        summary.reappearedFindings += 1;
      if (finding.memoryStatus === "false_positive_suppressed")
        summary.falsePositiveSuppressedFindings += 1;
      return summary;
    },
    {
      totalFindings: 0,
      newFindings: 0,
      existingFindings: 0,
      resolvedFindings: 0,
      reappearedFindings: 0,
      falsePositiveSuppressedFindings: 0,
    },
  );
}

function renderMarkdown(
  pack: Omit<EvidencePack, "markdown">,
  decisionMemories: FixDecisionMemory[],
): string {
  const lines = [
    "# AutoCyber Security Review Summary",
    "",
    `Repository: ${pack.repositoryName}`,
    `Scan: ${pack.scanId}`,
    `Source: ${pack.scanSource}`,
    `Scan timestamp: ${pack.scanTimestamp}`,
    "",
    "## Finding Changes",
    "",
    `Total findings: ${pack.summary.totalFindings}`,
    `New findings: ${pack.summary.newFindings}`,
    `Existing findings: ${pack.summary.existingFindings}`,
    `Resolved findings: ${pack.summary.resolvedFindings}`,
    `Reappeared findings: ${pack.summary.reappearedFindings}`,
    `False-positive-suppressed findings: ${pack.summary.falsePositiveSuppressedFindings}`,
    "",
    "## Top Active Risks",
    "",
    ...renderTopRisks(pack.topActiveRisks),
    "",
    "## Decision Memory",
    "",
    `Accepted fix history: ${pack.acceptedFixHistoryCount}`,
    `Rejected/manual decision history: ${pack.rejectedManualDecisionCount}`,
    `Remediations applied: ${pack.remediationsAppliedCount}`,
    ...renderDecisionNotes(decisionMemories),
    "",
    "## Verification",
    "",
    `Verification: ${pack.verificationSummary}`,
    "",
    "## Known Limitations",
    "",
    ...pack.knownLimitations.map((limitation) => `- ${limitation}`),
    "",
    "## Next recommended actions",
    "",
    ...pack.nextRecommendedActions.map((action) => `- ${action}`),
  ];
  return lines.join("\n");
}

function renderTopRisks(risks: EvidencePackTopRisk[]): string[] {
  if (risks.length === 0)
    return ["No active non-suppressed risks were found in this scan."];
  return risks.flatMap((risk, index) => [
    `${index + 1}. ${risk.title}`,
    `   - Rule: ${risk.ruleId}`,
    `   - Severity: ${risk.severity}`,
    `   - Lifecycle: ${risk.lifecycleStatus}`,
    `   - Priority: ${formatPriorityBand(risk.priorityBand)} (${risk.priorityScore})`,
    `   - Affected file: ${risk.affectedFile}`,
    `   - Reason: ${risk.priorityReasons[0] ?? "Requires security review"}`,
  ]);
}

function renderDecisionNotes(decisionMemories: FixDecisionMemory[]): string[] {
  const notes = decisionMemories
    .filter(
      (memory) =>
        memory.decisionType === "fix_rejected" ||
        memory.decisionType === "manual_fix_preferred" ||
        memory.decisionType === "false_positive",
    )
    .slice(0, 3)
    .map(
      (memory) =>
        `- ${formatDecisionType(memory.decisionType)} for ${memory.ruleId}${memory.rationale ? `: ${redactEvidenceText(memory.rationale)}` : ""}`,
    );
  return notes.length ? ["", "Recent decision notes:", ...notes] : [];
}

function summarizeVerification(results: VerificationResult[]): string {
  if (results.length === 0) return "No verification results attached";
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const running = results.filter(
    (result) => result.status === "running",
  ).length;
  return [`${passed} passed`, `${failed} failed`, `${running} running`].join(
    ", ",
  );
}

function buildNextActions(
  topRisks: EvidencePackTopRisk[],
  summary: EvidencePackSummary,
  memories: FixDecisionMemory[],
): string[] {
  const actions: string[] = [];
  if (topRisks.length > 0)
    actions.push(
      "Review the highest-priority active risks before lower-priority existing findings.",
    );
  if (memories.some((memory) => memory.decisionType === "fix_accepted"))
    actions.push(
      "Reuse previously accepted fix patterns where still applicable.",
    );
  if (
    memories.some(
      (memory) =>
        memory.decisionType === "fix_rejected" ||
        memory.decisionType === "manual_fix_preferred",
    )
  ) {
    actions.push(
      "Respect rejected/manual decision memory when proposing fixes.",
    );
  }
  if (summary.resolvedFindings > 0)
    actions.push(
      "Confirm resolved findings remain absent in the next monitoring scan.",
    );
  if (actions.length === 0)
    actions.push(
      "Continue monitoring and review future new or reappeared findings.",
    );
  return actions;
}

function formatScanSource(
  source: ScanJob["source"],
  repository: Repository,
): string {
  if (source === "manual")
    return repository.connectionType === "github_app"
      ? "Manual private GitHub App scan"
      : "Manual";
  if (source === "push") return "Push webhook";
  if (source === "pull_request") return "PR webhook";
  return "Scheduled";
}

function formatDecisionType(value: FixDecisionMemory["decisionType"]): string {
  const formatted = value.replaceAll("_", " ");
  return `${formatted.charAt(0).toUpperCase()}${formatted.slice(1)}`;
}
