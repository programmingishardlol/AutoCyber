import { NextResponse } from "next/server";
import type { FixDecisionType, FixProposal } from "@autocyber/core";
import { isFixDecisionType } from "../../../../lib/fix-decision-memory";
import { getPersistenceStore } from "../../../../lib/persistence/store";

export const runtime = "nodejs";

interface DecisionRequest {
  proposal?: unknown;
  decisionType?: unknown;
  note?: unknown;
  actorUserId?: unknown;
}

export async function POST(request: Request) {
  let input: DecisionRequest;

  try {
    input = (await request.json()) as DecisionRequest;
  } catch {
    return invalidDecisionInput();
  }

  if (!isFixDecisionType(input.decisionType) || !isProposal(input.proposal)) {
    return invalidDecisionInput();
  }

  const note = typeof input.note === "string" ? input.note : null;
  const actorUserId =
    typeof input.actorUserId === "string" ? input.actorUserId : null;
  const proposal = input.proposal;
  const store = getPersistenceStore();

  if (
    input.decisionType === "fix_accepted" ||
    input.decisionType === "fix_rejected"
  ) {
    const updatedProposal: FixProposal = {
      ...proposal,
      status: input.decisionType === "fix_accepted" ? "approved" : "rejected",
      updatedAt: new Date().toISOString(),
    };
    await store.saveFixProposal(updatedProposal, {
      decisionRationale: note,
      actorUserId,
    });
    return NextResponse.json({ proposal: updatedProposal }, { status: 200 });
  }

  await store.recordFixDecisionMemory({
    repositoryId: proposal.repositoryId,
    findingFingerprint: proposal.findingFingerprint ?? proposal.findingId,
    ruleId: proposal.ruleId ?? "unknown",
    decisionType: input.decisionType,
    proposal,
    rationale: note,
    actorUserId,
  });

  return NextResponse.json({ proposal }, { status: 200 });
}

function invalidDecisionInput() {
  return NextResponse.json(
    {
      error: "invalid decision input",
      message: "A valid proposal and decisionType are required.",
    },
    { status: 400 },
  );
}

function isProposal(value: unknown): value is FixProposal {
  if (!isRecord(value)) return false;
  return (
    hasString(value, "id") &&
    hasString(value, "findingId") &&
    hasString(value, "repositoryId") &&
    hasString(value, "status") &&
    hasString(value, "kind") &&
    hasString(value, "title") &&
    hasString(value, "explanation") &&
    hasString(value, "proposedPatch") &&
    hasString(value, "diff") &&
    hasString(value, "risk") &&
    Array.isArray(value.verificationPlan) &&
    Array.isArray(value.filesChanged) &&
    hasString(value, "createdAt") &&
    hasString(value, "updatedAt")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}
