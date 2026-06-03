import { createHash } from "node:crypto";
import type { NormalizedFinding, ScannerEvidence, ScannerRuleId } from "../types";
import type { Severity, StackTag } from "@autocyber/core";

interface FindingInput {
  repositoryId: string;
  scanJobId: string;
  ruleId: ScannerRuleId;
  title: string;
  category: string;
  severity: Severity;
  confidence: number;
  stackTags: StackTag[];
  affectedFile: string;
  evidence: ScannerEvidence[];
  riskExplanation: string;
  remediationSummary: string;
  verificationStrategy?: string;
  autofixAvailable?: boolean;
}

export function createFinding(input: FindingInput): NormalizedFinding {
  const hash = createHash("sha256")
    .update(`${input.ruleId}:${input.affectedFile}:${input.evidence[0]?.startLine ?? 1}`)
    .digest("hex")
    .slice(0, 10);

  return {
    id: `${input.scanJobId}:local:${input.ruleId}:${hash}`,
    repositoryId: input.repositoryId,
    scanJobId: input.scanJobId,
    ruleId: input.ruleId,
    title: input.title,
    category: input.category,
    severity: input.severity,
    confidence: input.confidence,
    status: "open",
    stackTags: input.stackTags,
    affectedFile: input.affectedFile,
    evidence: input.evidence,
    riskExplanation: input.riskExplanation,
    remediationSummary: input.remediationSummary,
    verificationStrategy:
      input.verificationStrategy ??
      "Rerun the AutoCyber local scanner against the repository and confirm this rule no longer produces a finding for the affected file.",
    autofixAvailable: input.autofixAvailable ?? false
  };
}

export function createEvidence(filePath: string, lineNumber: number, snippet: string): ScannerEvidence {
  return {
    filePath,
    startLine: lineNumber,
    endLine: lineNumber,
    snippet: redactSecrets(snippet.trimEnd())
  };
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(sk-(?:proj-)?)[A-Za-z0-9_-]{12,}/g, "$1[REDACTED]")
    .replace(
      /^(\s*(?:export\s+)?[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PRIVATE_KEY|SERVICE_ROLE)[A-Z0-9_]*\s*=\s*)["']?[^"'\s#]+["']?/gim,
      "$1[REDACTED]"
    )
    .replace(/(=)\s*["']?[A-Za-z0-9_./+=-]{24,}["']?/g, "$1[REDACTED]");
}
