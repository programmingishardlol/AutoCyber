import type { FindingStatus, Severity, StackTag } from "@autocyber/core";

export const scannerRuleIds = [
  "exposed-secret",
  "missing-env-example",
  "unsafe-cors-wildcard",
  "missing-api-auth",
  "missing-authorization",
  "missing-security-headers",
  "dangerous-public-env",
  "insecure-webhook-handler",
  "dependency-risk-placeholder",
  "unsafe-supabase-usage",
  "unsafe-stripe-payment-state",
  "unsafe-ai-api-usage",
  "supabase-exposed-service-role-key",
  "supabase-service-role-in-client",
  "supabase-permissive-rls-policy",
  "supabase-missing-rls",
  "next-public-sensitive-env",
  "next-client-secret-reference",
  "vercel-risky-config",
  "clerk-api-missing-auth",
  "clerk-missing-org-authorization",
  "clerk-middleware-gap",
  "stripe-webhook-missing-construct-event",
  "stripe-client-trusted-payment-state",
  "stripe-exposed-secret-key",
  "ai-route-missing-rate-limit",
  "ai-unsafe-prompt-logging",
  "ai-client-side-key-usage"
] as const;

export type ScannerRuleId = (typeof scannerRuleIds)[number];

export interface ScannerInput {
  repositoryPath: string;
  repositoryId?: string;
  scanJobId?: string;
  maxFileSizeBytes?: number;
}

export interface ScannerEvidence {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface NormalizedFinding {
  id: string;
  repositoryId: string;
  scanJobId: string;
  ruleId: ScannerRuleId;
  title: string;
  category: string;
  severity: Severity;
  confidence: number;
  status: FindingStatus;
  stackTags: StackTag[];
  affectedFile: string;
  evidence: ScannerEvidence[];
  riskExplanation: string;
  remediationSummary: string;
  verificationStrategy: string;
  autofixAvailable: boolean;
}

export interface ScannerError {
  path: string;
  message: string;
}

export interface ScannerResult {
  scanner: "mock" | "local";
  repositoryPath: string;
  repositoryId: string;
  scanJobId: string;
  projectProfile: ProjectProfile;
  filesScanned: number;
  rulesRun: ScannerRuleId[];
  findings: NormalizedFinding[];
  errors: ScannerError[];
}

export interface ProjectProfile {
  frameworks: string[];
  languages: string[];
  integrations: string[];
  deploymentProviders: string[];
  packageManagers: string[];
}

export interface Scanner {
  scan(input: ScannerInput): Promise<ScannerResult>;
}

export interface ScannedFile {
  path: string;
  relativePath: string;
  content: string;
}

export interface RuleContext {
  repositoryPath: string;
  repositoryId: string;
  scanJobId: string;
  files: ScannedFile[];
  hasFile(relativePath: string): boolean;
}

export interface ScannerRule {
  id: ScannerRuleId;
  run(context: RuleContext): NormalizedFinding[];
}
