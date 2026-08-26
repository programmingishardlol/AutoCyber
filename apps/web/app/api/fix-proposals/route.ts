import { NextResponse } from "next/server";
import type { FixDecisionMemoryContext, FixProposal } from "@autocyber/core";
import {
  generateFixProposal,
  type RemediationFinding,
} from "@autocyber/remediation";
import {
  emptyFixDecisionMemoryContext,
  getProposalPatchHash,
  getProposalRecommendedFixHash,
  hasDecisionMemoryContext,
} from "../../../lib/fix-decision-memory";
import { getPersistenceStore } from "../../../lib/persistence/store";
import { scoreProposalPriority } from "../../../lib/priority-scoring";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "invalid proposal input",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const finding = parseFinding(body);
  if (!finding) {
    return NextResponse.json(
      {
        error: "invalid proposal input",
        message:
          "A normalized finding with id, repositoryId, title, category, affectedFile, evidence, and remediation fields is required.",
      },
      { status: 400 },
    );
  }

  const store = getPersistenceStore();
  const generatedProposal = withProposalHashes(generateFixProposal(finding));
  const decisionMemory = await store.getFixDecisionMemoryContext({
    repositoryId: finding.repositoryId,
    findingFingerprint:
      finding.fingerprint ?? generatedProposal.findingFingerprint ?? finding.id,
    ruleId: finding.ruleId ?? generatedProposal.ruleId ?? "unknown",
    patchHash: generatedProposal.patchHash,
    recommendedFixHash: generatedProposal.recommendedFixHash,
  });
  const proposal = scoreProposalPriority(
    applyDecisionMemory(generatedProposal, decisionMemory, parseForce(body)),
    finding,
    {
      decisionMemory,
    },
  ).proposal;
  await store.saveFixProposal(proposal);

  return NextResponse.json({ proposal }, { status: 200 });
}

function parseFinding(value: unknown): RemediationFinding | null {
  if (!isRecord(value)) return null;
  const finding = isRecord(value.finding) ? value.finding : value;

  if (
    !hasString(finding, "id") ||
    !hasString(finding, "repositoryId") ||
    !hasString(finding, "title") ||
    !hasString(finding, "category") ||
    !hasString(finding, "severity") ||
    !hasString(finding, "status") ||
    !hasString(finding, "affectedFile") ||
    !hasString(finding, "riskExplanation") ||
    !hasString(finding, "remediationSummary") ||
    !Array.isArray(finding.evidence) ||
    !Array.isArray(finding.stackTags) ||
    typeof finding.confidence !== "number" ||
    typeof finding.autofixAvailable !== "boolean"
  ) {
    return null;
  }

  return finding as unknown as RemediationFinding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}

function withProposalHashes(proposal: FixProposal): FixProposal {
  return {
    ...proposal,
    patchHash: getProposalPatchHash(proposal),
    recommendedFixHash: getProposalRecommendedFixHash(proposal),
  };
}

function applyDecisionMemory(
  proposal: FixProposal,
  context: FixDecisionMemoryContext,
  force = false,
): FixProposal {
  const decisionMemory = hasDecisionMemoryContext(context)
    ? context
    : emptyFixDecisionMemoryContext();

  if (decisionMemory.falsePositiveMemory && !force) {
    return {
      ...proposal,
      kind: "advisory",
      title: `False positive memory: ${proposal.title}`,
      explanation: appendSentence(
        proposal.explanation,
        "This finding fingerprint is remembered as a false positive for this repository, so AutoCyber is not creating a noisy patch proposal unless explicitly requested.",
      ),
      proposedPatch:
        "No patch proposal generated because this fingerprint is remembered as false positive.",
      diff: `# False positive memory for ${proposal.findingFingerprint ?? proposal.findingId}.
# Review only if the repository context has changed.`,
      risk: appendSentence(
        proposal.risk,
        "False positive memory is repository-scoped; verify manually before changing code.",
      ),
      decisionMemory,
    };
  }

  let explanation = proposal.explanation;
  let risk = proposal.risk;
  if (decisionMemory.previouslyAccepted) {
    explanation = appendSentence(
      explanation,
      "Previously accepted fix pattern available.",
    );
  }
  if (decisionMemory.previouslyRejected) {
    risk = appendSentence(risk, "Similar fix was previously rejected.");
  }
  if (decisionMemory.samePatchPreviouslyRejected) {
    risk = appendSentence(
      risk,
      "This exact patch hash was previously rejected.",
    );
  }
  if (decisionMemory.manualFixPreferred) {
    explanation = appendSentence(
      explanation,
      "Manual fix preferred for this finding memory.",
    );
  }

  return {
    ...proposal,
    explanation,
    risk,
    decisionMemory,
  };
}

function appendSentence(value: string, sentence: string): string {
  return value.includes(sentence)
    ? value
    : `${value}${value.endsWith(".") ? "" : "."} ${sentence}`;
}

function parseForce(value: unknown): boolean {
  return isRecord(value) && value.force === true;
}
