import type {
  Finding,
  FindingLifecycleStatus,
  FindingMemoryStatus,
  FixDecisionMemory,
  FixDecisionMemoryContext,
  FixProposal,
  PriorityBand,
  Severity,
  StackTag,
} from "@autocyber/core";
import type { NormalizedFinding } from "@autocyber/scanner";
import {
  buildFixDecisionMemoryContext,
  emptyFixDecisionMemoryContext,
} from "./fix-decision-context";

export interface FindingPriority {
  priorityScore: number;
  priorityBand: PriorityBand;
  priorityReasons: string[];
}

export interface PriorityScoringOptions {
  decisionMemory?: FixDecisionMemoryContext | null;
}

export interface PriorityRankingOptions {
  decisionMemories?: FixDecisionMemory[];
}

export interface RankedFinding<
  TFinding extends PriorityFinding = PriorityFinding,
> {
  finding: TFinding;
  priority: FindingPriority;
}

export interface RankedProposal<TProposal extends FixProposal = FixProposal> {
  proposal: TProposal;
  priority: FindingPriority;
}

interface PriorityFinding {
  id: string;
  repositoryId: string;
  ruleId?: string;
  title: string;
  category: string;
  severity: Severity;
  confidence: number;
  lifecycleStatus?: FindingLifecycleStatus;
  resolvedAt?: string | null;
  fingerprint?: string;
  memoryStatus?: FindingMemoryStatus;
  stackTags: StackTag[];
  affectedFile: string;
  riskExplanation: string;
  remediationSummary: string;
}

const severityScore: Record<Severity, number> = {
  critical: 90,
  high: 70,
  medium: 45,
  low: 25,
  info: 10,
};

export function scoreFindingPriority(
  finding: PriorityFinding,
  options: PriorityScoringOptions = {},
): FindingPriority {
  const memory = options.decisionMemory ?? emptyFixDecisionMemoryContext();

  if (finding.lifecycleStatus === "resolved") {
    return {
      priorityScore: 0,
      priorityBand: "resolved",
      priorityReasons: ["Resolved finding is not active risk"],
    };
  }

  if (
    finding.memoryStatus === "false_positive_suppressed" ||
    memory.falsePositiveMemory
  ) {
    return {
      priorityScore: 10,
      priorityBand: "monitor",
      priorityReasons: [
        "False positive memory suppresses noisy recommendations",
      ],
    };
  }

  let score = severityScore[finding.severity] ?? 10;
  const reasons: string[] = [`${formatReasonValue(finding.severity)} severity`];
  const confidence = Number.isFinite(finding.confidence)
    ? finding.confidence
    : 0;
  score += Math.round(Math.max(0, Math.min(1, confidence)) * 10);

  if (finding.lifecycleStatus === "new") {
    score += 10;
    reasons.push("New in latest scan");
  } else if (finding.lifecycleStatus === "reappeared") {
    score += 16;
    reasons.push("Reappeared after being resolved");
  } else if (finding.lifecycleStatus === "existing") {
    score -= finding.severity === "critical" ? 2 : 8;
    reasons.push("Existing finding carried forward");
  }

  for (const signal of getContextSignals(finding)) {
    score += signal.score;
    reasons.push(signal.reason);
  }

  if (memory.previouslyAccepted) {
    score += 8;
    reasons.push("Previously accepted fix pattern available");
  }
  if (memory.previouslyRejected) {
    score -= 12;
    reasons.push("Similar fix was previously rejected");
  }
  if (memory.samePatchPreviouslyRejected) {
    score -= 8;
    reasons.push("Same patch was previously rejected");
  }
  if (memory.manualFixPreferred) {
    score -= 6;
    reasons.push("Manual fix preferred");
  }

  const priorityScore = clampScore(score);
  const orderedReasons = orderPriorityReasons(uniqueReasons(reasons));
  return {
    priorityScore,
    priorityBand: bandForScore(priorityScore),
    priorityReasons: orderedReasons.slice(0, 10),
  };
}

export function rankFindingsByPriority<TFinding extends PriorityFinding>(
  findings: TFinding[],
  options: PriorityRankingOptions = {},
): Array<RankedFinding<TFinding>> {
  return findings
    .map((finding) => {
      const decisionMemory = options.decisionMemories
        ? buildFixDecisionMemoryContext(
            options.decisionMemories.filter(
              (memory) =>
                memory.repositoryId === finding.repositoryId &&
                memory.findingFingerprint ===
                  (finding.fingerprint ?? finding.id) &&
                memory.ruleId === (finding.ruleId ?? "unknown"),
            ),
          )
        : undefined;
      return {
        finding,
        priority: scoreFindingPriority(finding, { decisionMemory }),
      };
    })
    .sort(
      (left, right) =>
        right.priority.priorityScore - left.priority.priorityScore ||
        compareSeverity(right.finding.severity, left.finding.severity),
    );
}

export function withFindingPriority<TFinding extends PriorityFinding>(
  finding: TFinding,
  options: PriorityScoringOptions = {},
): TFinding & FindingPriority {
  const priority = scoreFindingPriority(finding, options);
  return {
    ...finding,
    ...priority,
  };
}

export function scoreProposalPriority<TProposal extends FixProposal>(
  proposal: TProposal,
  finding: PriorityFinding,
  options: PriorityScoringOptions = {},
): RankedProposal<TProposal> {
  const decisionMemory =
    options.decisionMemory ??
    proposal.decisionMemory ??
    emptyFixDecisionMemoryContext();
  const base = scoreFindingPriority(finding, { decisionMemory });
  let score = base.priorityScore;
  const reasons = [...base.priorityReasons];

  if (proposal.kind === "patch") {
    score += 8;
    reasons.push("Patch proposal is directly actionable");
  } else {
    score -= 4;
    reasons.push("Advisory/manual guidance");
  }

  if (proposal.verificationPlan.length > 0) {
    score += 4;
    reasons.push("Verification plan available");
  }

  if (proposal.filesChanged.length > 2) {
    score -= 4;
    reasons.push("Larger patch needs closer review");
  }

  const priorityScore = decisionMemory.falsePositiveMemory
    ? 10
    : clampScore(score);
  const priority: FindingPriority = {
    priorityScore,
    priorityBand: decisionMemory.falsePositiveMemory
      ? "monitor"
      : bandForScore(priorityScore),
    priorityReasons: orderPriorityReasons(uniqueReasons(reasons)).slice(0, 10),
  };

  return {
    proposal: {
      ...proposal,
      ...priority,
    },
    priority,
  };
}

export function formatPriorityBand(value: PriorityBand): string {
  return value.replaceAll("_", " ");
}

function getContextSignals(
  finding: PriorityFinding,
): Array<{ score: number; reason: string }> {
  const values = [
    finding.ruleId,
    finding.category,
    finding.title,
    finding.affectedFile,
    finding.riskExplanation,
    finding.remediationSummary,
    ...finding.stackTags,
  ]
    .join(" ")
    .toLowerCase();
  const signals: Array<{ score: number; reason: string }> = [];
  const apiRoute =
    /(^|\/)(app|pages)\/api\//.test(finding.affectedFile) ||
    values.includes(" api ");

  if (apiRoute)
    signals.push({ score: 10, reason: "Public API route involved" });
  if (/(auth|authorization|clerk|session|admin|user)/.test(values))
    signals.push({ score: 8, reason: "Auth boundary involved" });
  if (
    /(secret|token|api key|private key|database url|service role)/.test(values)
  )
    signals.push({ score: 16, reason: "Secret or credential exposure signal" });
  if (values.includes("cors") && values.includes("wildcard"))
    signals.push({ score: 10, reason: "CORS wildcard risk" });
  if (values.includes("cors") && /(auth|admin|user|session)/.test(values))
    signals.push({
      score: 12,
      reason: "CORS wildcard with auth-sensitive route",
    });
  if (values.includes("supabase") && /(rls|row level|permissive)/.test(values))
    signals.push({ score: 14, reason: "Supabase RLS issue" });
  if (
    values.includes("stripe") &&
    /(webhook|constructevent|signature)/.test(values)
  )
    signals.push({ score: 14, reason: "Stripe webhook verification issue" });
  if (
    /(openai|anthropic|ai-|prompt|llm|model)/.test(values) &&
    /(key|prompt|log|logging|rate limit|client)/.test(values)
  ) {
    signals.push({ score: 10, reason: "AI prompt/key/logging issue" });
  }

  return uniqueSignals(signals);
}

function bandForScore(score: number): PriorityBand {
  if (score >= 90) return "critical_action";
  if (score >= 70) return "high_priority";
  if (score >= 45) return "review_needed";
  return "monitor";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function compareSeverity(left: Severity, right: Severity): number {
  return severityScore[left] - severityScore[right];
}

function uniqueSignals(
  signals: Array<{ score: number; reason: string }>,
): Array<{ score: number; reason: string }> {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    if (seen.has(signal.reason)) return false;
    seen.add(signal.reason);
    return true;
  });
}

function uniqueReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons));
}

function orderPriorityReasons(reasons: string[]): string[] {
  return [...reasons].sort(
    (left, right) => reasonWeight(left) - reasonWeight(right),
  );
}

function reasonWeight(reason: string): number {
  if (reason === "Reappeared after being resolved") return 1;
  if (reason === "Public API route involved") return 2;
  if (reason === "Auth boundary involved") return 3;
  if (reason === "Secret or credential exposure signal") return 3;
  if (reason === "Supabase RLS issue") return 3;
  if (reason === "Stripe webhook verification issue") return 3;
  if (reason === "AI prompt/key/logging issue") return 3;
  if (reason === "New in latest scan") return 4;
  if (reason === "Previously accepted fix pattern available") return 5;
  if (reason === "Patch proposal is directly actionable") return 6;
  if (reason === "Verification plan available") return 7;
  if (reason === "Similar fix was previously rejected") return 8;
  if (reason === "Same patch was previously rejected") return 8;
  if (reason === "Manual fix preferred") return 8;
  if (reason.endsWith("severity")) return 9;
  return 10;
}

function formatReasonValue(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}
