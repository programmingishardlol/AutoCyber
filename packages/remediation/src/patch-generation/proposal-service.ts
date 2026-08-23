import type { FixProposal, FixProposalStatus } from "@autocyber/core";
import { getRuleBasedTemplate } from "./rule-templates";
import type { GenerateFixProposalOptions, RemediationFinding } from "../types";

export function generateFixProposal(
  finding: RemediationFinding,
  options: GenerateFixProposalOptions = {},
): FixProposal {
  const now = options.now ?? new Date().toISOString();
  const template = getRuleBasedTemplate(finding.ruleId);

  if (!template) {
    return createFallbackProposal(finding, now);
  }

  const diff = template.diff(finding);

  return {
    id: createProposalId(finding),
    findingId: finding.id,
    repositoryId: finding.repositoryId,
    findingFingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    status: "draft",
    kind: getProposalKind(diff),
    title: template.title(finding),
    explanation: template.explanation(finding),
    proposedPatch: template.proposedPatch(finding),
    diff,
    risk: template.risk(finding),
    verificationPlan: uniqueSteps(template.verificationPlan(finding)),
    filesChanged: template.filesChanged(finding),
    createdAt: now,
    updatedAt: now,
  };
}

export function updateFixProposalStatus(
  proposal: FixProposal,
  status: FixProposalStatus,
  options: GenerateFixProposalOptions = {},
): FixProposal {
  return {
    ...proposal,
    status,
    updatedAt: options.now ?? new Date().toISOString(),
  };
}

function createFallbackProposal(
  finding: RemediationFinding,
  now: string,
): FixProposal {
  return {
    id: createProposalId(finding),
    findingId: finding.id,
    repositoryId: finding.repositoryId,
    findingFingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    status: "draft",
    kind: "advisory",
    title: `Manual remediation plan for ${finding.title}`,
    explanation:
      "AutoCyber does not have a deterministic patch template for this finding yet. A human should review the evidence and apply the scanner recommendation manually.",
    proposedPatch:
      "No automatic patch template is available for this rule yet.",
    diff: `# No automatic patch template is available for ${finding.ruleId ?? finding.category}.
# Review ${finding.affectedFile} and apply the remediation manually.`,
    risk: "Manual review required. Applying a generic patch could change the wrong behavior or hide uncertainty.",
    verificationPlan: uniqueSteps([
      finding.verificationStrategy ??
        "Rerun the AutoCyber scanner after the manual remediation.",
      "Confirm the original finding no longer appears.",
      "Run relevant typecheck, tests, or app smoke checks for the affected area.",
    ]),
    filesChanged: [finding.affectedFile],
    createdAt: now,
    updatedAt: now,
  };
}

function createProposalId(finding: RemediationFinding): string {
  return `fix_${simpleHash(`${finding.repositoryId}:${finding.id}:${finding.ruleId ?? finding.category}`)}`;
}

function getProposalKind(diff: string): FixProposal["kind"] {
  const normalized = diff.trimStart();
  return normalized.startsWith("# Advisory only") ||
    !normalized.includes("--- ") ||
    !normalized.includes("+++ ")
    ? "advisory"
    : "patch";
}

function simpleHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 10);
}

function uniqueSteps(steps: string[]): string[] {
  return Array.from(new Set(steps.filter(Boolean)));
}
