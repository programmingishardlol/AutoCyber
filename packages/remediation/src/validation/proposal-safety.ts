import type { FixProposal } from "@autocyber/core";
import type { LocalRemediationExecution } from "../types";

export const ADVISORY_ONLY_REMEDIATION_ERROR = "This is an advisory-only proposal and cannot be automatically remediated.";
export const INVALID_UNIFIED_DIFF_ERROR = "Fix proposal does not contain an applyable unified diff.";
export const LOCAL_REMEDIATION_APPROVAL_ERROR = "Fix proposal must be approved before remediation can run.";
export const GITHUB_PR_APPROVAL_ERROR = "Fix proposal must be approved before creating a GitHub PR.";
export const GITHUB_PR_VERIFICATION_ERROR = "Local verification must pass before creating a GitHub PR.";
export const GITHUB_PR_WORKING_COPY_ERROR = "A verified temporary working copy is required before creating a GitHub PR.";

export function getAutomaticRemediationBlockReason(proposal: FixProposal): string | null {
  if (isAdvisoryOnlyProposal(proposal)) {
    return ADVISORY_ONLY_REMEDIATION_ERROR;
  }

  if (!hasApplyableUnifiedDiff(proposal.diff)) {
    return INVALID_UNIFIED_DIFF_ERROR;
  }

  return null;
}

export function getLocalRemediationBlockReason(proposal: FixProposal): string | null {
  if (proposal.status !== "approved") {
    return LOCAL_REMEDIATION_APPROVAL_ERROR;
  }

  return getAutomaticRemediationBlockReason(proposal);
}

export function getGitHubPrBlockReason(proposal: FixProposal, execution: LocalRemediationExecution): string | null {
  if (proposal.status !== "approved") {
    return GITHUB_PR_APPROVAL_ERROR;
  }

  const proposalBlockReason = getAutomaticRemediationBlockReason(proposal);
  if (proposalBlockReason) {
    return proposalBlockReason;
  }

  if (!localVerificationPassed(execution)) {
    return GITHUB_PR_VERIFICATION_ERROR;
  }

  if (!execution.workingCopyPath) {
    return GITHUB_PR_WORKING_COPY_ERROR;
  }

  return null;
}

function isAdvisoryOnlyProposal(proposal: FixProposal): boolean {
  const proposedPatch = proposal.proposedPatch.trimStart();
  const diff = proposal.diff.trimStart();

  return (
    proposal.kind === "advisory" ||
    /^Manual remediation required\b/i.test(proposedPatch) ||
    /^No automatic patch template\b/i.test(proposedPatch) ||
    /^# Advisory only\b/i.test(diff) ||
    /^# No automatic patch template\b/i.test(diff)
  );
}

function hasApplyableUnifiedDiff(diff: string): boolean {
  return /^--- (?:a\/|\/dev\/null)/m.test(diff) && /^\+\+\+ (?:b\/|\/dev\/null)/m.test(diff) && /^@@/m.test(diff);
}

function localVerificationPassed(execution: LocalRemediationExecution): boolean {
  return execution.status === "verified" && execution.verificationResult?.status === "passed";
}
