import { createHash } from "node:crypto";
import type { FixDecisionType, FixProposal } from "@autocyber/core";
export {
  buildFixDecisionMemoryContext,
  emptyFixDecisionMemoryContext,
  hasDecisionMemoryContext,
} from "./fix-decision-context";

export const fixDecisionTypes = [
  "fix_accepted",
  "fix_rejected",
  "remediation_applied",
  "advisory_acknowledged",
  "false_positive",
  "manual_fix_preferred",
] as const satisfies readonly FixDecisionType[];

export function isFixDecisionType(value: unknown): value is FixDecisionType {
  return (
    typeof value === "string" &&
    fixDecisionTypes.includes(value as FixDecisionType)
  );
}

export function hashDecisionValue(value: string): string {
  const normalized = redactSensitiveText(value).trim().replace(/\s+/g, " ");
  return `hash_${createHash("sha256").update(normalized).digest("hex").slice(0, 32)}`;
}

export function getProposalPatchHash(
  proposal: Pick<FixProposal, "diff">,
): string | null {
  const diff = proposal.diff.trim();
  return diff ? hashDecisionValue(diff) : null;
}

export function getProposalRecommendedFixHash(
  proposal: Pick<FixProposal, "kind" | "proposedPatch" | "filesChanged">,
): string | null {
  const value =
    `${proposal.kind}:${proposal.filesChanged.join(",")}:${proposal.proposedPatch}`.trim();
  return value ? hashDecisionValue(value) : null;
}

export function sanitizeDecisionNote(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const sanitized = redactSensitiveText(value).trim().slice(0, 1000);
  return sanitized.length ? sanitized : null;
}

export function redactSensitiveText(value: string): string {
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
