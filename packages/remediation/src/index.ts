export { mockFixProposal } from "./patch-generation/mock-proposals";
export { generateFixProposal, updateFixProposalStatus } from "./patch-generation/proposal-service";
export { getRuleBasedTemplate, ruleBasedFixProposalTemplates } from "./patch-generation/rule-templates";
export {
  createGitHubPrRemediation,
  createOctokitRemediationClient,
  createPullRequestBody,
  createPullRequestTitle,
  createRemediationBranchName
} from "./pr-writer/github-pr";
export {
  applyApprovedProposalToTempCopy,
  createLocalRemediationExecution,
  runLocalRemediation,
  runRemediationVerification
} from "./verification/local-remediation";
export {
  ADVISORY_ONLY_REMEDIATION_ERROR,
  GITHUB_PR_APPROVAL_ERROR,
  GITHUB_PR_VERIFICATION_ERROR,
  GITHUB_PR_WORKING_COPY_ERROR,
  INVALID_UNIFIED_DIFF_ERROR,
  LOCAL_REMEDIATION_APPROVAL_ERROR,
  getAutomaticRemediationBlockReason,
  getGitHubPrBlockReason,
  getLocalRemediationBlockReason
} from "./validation/proposal-safety";
export type { GitHubFileCommit, GitHubPrRemediationInput, GitHubRemediationClient } from "./pr-writer/github-pr";
export type {
  GenerateFixProposalOptions,
  GitHubPrRemediationResult,
  GitHubPrRemediationStatus,
  GitHubRepositoryTarget,
  GitHubTokenMode,
  LocalRemediationExecution,
  OriginalFindingReference,
  RemediationCheckStatus,
  RemediationExecutionStatus,
  RemediationFinding,
  RemediationRuleId,
  RemediationVerificationCheck,
  RemediationVerificationResult
} from "./types";

export const remediationPackageStatus = {
  implemented: true,
  stage: "Stage 4B GitHub PR remediation",
  next: "Stage 4B should be audited with a user-owned GitHub test repo before Stage 5 integrations."
} as const;
