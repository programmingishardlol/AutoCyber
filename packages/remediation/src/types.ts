import type { FindingEvidence, FindingStatus, FixProposal, FixProposalStatus, Severity, StackTag } from "@autocyber/core";

export type RemediationRuleId =
  | "exposed-secret"
  | "missing-env-example"
  | "unsafe-cors-wildcard"
  | "missing-api-auth"
  | "missing-authorization"
  | "missing-security-headers"
  | "dangerous-public-env"
  | "insecure-webhook-handler"
  | "dependency-risk-placeholder"
  | "unsafe-supabase-usage"
  | "unsafe-stripe-payment-state"
  | "unsafe-ai-api-usage"
  | string;

export interface RemediationFinding {
  id: string;
  repositoryId: string;
  ruleId?: RemediationRuleId;
  title: string;
  category: string;
  severity: Severity;
  confidence: number;
  status: FindingStatus;
  stackTags: StackTag[];
  affectedFile: string;
  evidence: FindingEvidence[];
  riskExplanation: string;
  remediationSummary: string;
  verificationStrategy?: string;
  autofixAvailable: boolean;
}

export interface FixProposalTemplate {
  title(finding: RemediationFinding): string;
  explanation(finding: RemediationFinding): string;
  proposedPatch(finding: RemediationFinding): string;
  diff(finding: RemediationFinding): string;
  risk(finding: RemediationFinding): string;
  filesChanged(finding: RemediationFinding): string[];
  verificationPlan(finding: RemediationFinding): string[];
}

export interface GenerateFixProposalOptions {
  now?: string;
}

export type RemediationExecutionStatus = "pending" | "approved" | "applying" | "verifying" | "verified" | "failed";

export type RemediationCheckStatus = "passed" | "failed" | "skipped";

export interface RemediationVerificationCheck {
  name: "scanner-rule" | "typecheck" | "test" | "pattern";
  status: RemediationCheckStatus;
  outputSummary: string;
}

export interface RemediationVerificationResult {
  status: RemediationCheckStatus;
  checksRun: RemediationVerificationCheck[];
  outputSummary: string;
  limitations: string[];
}

export interface LocalRemediationExecution {
  id: string;
  fixProposalId: string;
  repositoryId: string;
  status: RemediationExecutionStatus;
  workingCopyPath: string | null;
  filesChanged: string[];
  verificationResult: RemediationVerificationResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OriginalFindingReference {
  ruleId: string;
  affectedFile: string;
}

export type GitHubTokenMode = "token" | "github-app";

export interface GitHubRepositoryTarget {
  owner: string;
  repo: string;
  defaultBranch: string;
  tokenMode: GitHubTokenMode;
  installationId?: string;
  repoUrl: string;
}

export type GitHubPrRemediationStatus = "blocked" | "creating_branch" | "pr_created" | "failed";

export interface GitHubPrRemediationResult {
  id: string;
  fixProposalId: string;
  repositoryId: string;
  provider: "github";
  status: GitHubPrRemediationStatus;
  branchName: string | null;
  pullRequestUrl: string | null;
  filesChanged: string[];
  verificationSummary: string;
  error: string | null;
  createdAt: string;
}

export type { FixProposal, FixProposalStatus };
