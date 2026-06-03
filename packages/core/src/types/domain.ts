export type ID = string;

export type ISODateTime = string;

export type ProductStage =
  | "stage-0-foundation"
  | "stage-1-repo-scanner"
  | "stage-2-findings-dashboard"
  | "stage-3-fix-proposals"
  | "stage-4-verified-pr-remediation"
  | "stage-5-startup-stack"
  | "stage-5d-infrastructure";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingStatus =
  | "open"
  | "triaged"
  | "fix_proposed"
  | "accepted"
  | "false_positive"
  | "resolved";

export type ScanStatus = "queued" | "running" | "completed" | "failed";

export type FixProposalStatus = "draft" | "approved" | "rejected";
export type FixProposalKind = "patch" | "advisory";

export type VerificationStatus = "not_started" | "running" | "passed" | "failed";

export type PullRequestStatus = "not_created" | "draft" | "open" | "merged" | "closed";

export type IntegrationStatus = "not_connected" | "connected" | "needs_attention";

export type StackTag =
  | "nextjs"
  | "node"
  | "python"
  | "supabase"
  | "firebase"
  | "vercel"
  | "railway"
  | "render"
  | "clerk"
  | "stripe"
  | "openai"
  | "anthropic";

export interface Team {
  id: ID;
  name: string;
  slug: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface User {
  id: ID;
  clerkUserId: string;
  email: string;
  name: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Project {
  id: ID;
  teamId: ID;
  name: string;
  slug: string;
  description: string;
  riskScore: number;
  stage: ProductStage;
  stack: StackTag[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Repository {
  id: ID;
  projectId: ID;
  provider: "github" | "local";
  owner: string;
  name: string;
  defaultBranch: string;
  url: string;
  lastScannedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ScanJob {
  id: ID;
  repositoryId: ID;
  status: ScanStatus;
  source: "manual" | "push" | "pull_request" | "scheduled";
  branch: string;
  commitSha: string;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

export interface FindingEvidence {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface Finding {
  id: ID;
  scanJobId: ID;
  repositoryId: ID;
  ruleId: string;
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
  verificationStrategy: string;
  autofixAvailable: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface FixProposal {
  id: ID;
  findingId: ID;
  repositoryId: ID;
  status: FixProposalStatus;
  kind: FixProposalKind;
  title: string;
  explanation: string;
  proposedPatch: string;
  diff: string;
  risk: string;
  verificationPlan: string[];
  filesChanged: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface VerificationResult {
  id: ID;
  fixProposalId: ID;
  status: VerificationStatus;
  scannerRerunStatus: VerificationStatus;
  testCommand: string;
  testOutputSummary: string;
  evidence: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PullRequestRecord {
  id: ID;
  fixProposalId: ID;
  repositoryId: ID;
  status: PullRequestStatus;
  branchName: string;
  title: string;
  summary: string;
  url: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Integration {
  id: ID;
  teamId: ID;
  provider: "github" | "vercel" | "supabase" | "clerk" | "stripe" | "firebase" | "railway" | "render" | "openai" | "anthropic";
  status: IntegrationStatus;
  displayName: string;
  description: string;
  lastCheckedAt: ISODateTime | null;
}

export interface SecurityMemory {
  id: ID;
  teamId?: ID;
  repositoryId: ID;
  kind: "architecture" | "repo_profile" | "accepted_fix" | "rejected_fix" | "false_positive" | "preference";
  title: string;
  content: string;
  source: "human" | "autocyber" | "scanner_observed" | "user_approved" | "user_rejected";
  confidence?: "high" | "medium" | "low";
  createdAt: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface WorkflowPlaybook {
  id: ID;
  name: string;
  slug: string;
  description: string;
  stackTags: StackTag[];
  detectionLogic: string;
  fixStrategy: string;
  verificationCheck: string;
}

export interface AuditLog {
  id: ID;
  teamId: ID;
  actor: string;
  action: string;
  targetType: string;
  targetId: ID;
  createdAt: ISODateTime;
}

export interface DashboardSummary {
  openFindings: number;
  verifiedFixes: number;
  connectedRepositories: number;
  integrationsNeedingAttention: number;
}
