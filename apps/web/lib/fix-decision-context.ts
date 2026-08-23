import type {
  FixDecisionMemory,
  FixDecisionMemoryContext,
} from "@autocyber/core";

export const emptyFixDecisionMemoryContext = (): FixDecisionMemoryContext => ({
  previouslyAccepted: false,
  previouslyRejected: false,
  manualFixPreferred: false,
  falsePositiveMemory: false,
  samePatchPreviouslyRejected: false,
  latestDecisionType: null,
  latestDecisionAt: null,
  latestRationale: null,
});

export function buildFixDecisionMemoryContext(
  memories: FixDecisionMemory[],
  patchHash?: string | null,
  recommendedFixHash?: string | null,
): FixDecisionMemoryContext {
  const context = emptyFixDecisionMemoryContext();
  const sorted = [...memories].sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  );
  const latest = sorted[0];

  for (const memory of sorted) {
    if (
      memory.decisionType === "fix_accepted" ||
      memory.decisionType === "remediation_applied"
    )
      context.previouslyAccepted = true;
    if (memory.decisionType === "fix_rejected")
      context.previouslyRejected = true;
    if (memory.decisionType === "manual_fix_preferred")
      context.manualFixPreferred = true;
    if (memory.decisionType === "false_positive")
      context.falsePositiveMemory = true;
    if (
      memory.decisionType === "fix_rejected" &&
      ((patchHash && memory.patchHash === patchHash) ||
        (recommendedFixHash &&
          memory.recommendedFixHash === recommendedFixHash))
    ) {
      context.samePatchPreviouslyRejected = true;
    }
  }

  if (latest) {
    context.latestDecisionType = latest.decisionType;
    context.latestDecisionAt = latest.createdAt;
    context.latestRationale = latest.rationale;
  }

  return context;
}

export function hasDecisionMemoryContext(
  context: FixDecisionMemoryContext,
): boolean {
  return (
    context.previouslyAccepted ||
    context.previouslyRejected ||
    context.manualFixPreferred ||
    context.falsePositiveMemory ||
    context.samePatchPreviouslyRejected ||
    Boolean(context.latestDecisionType)
  );
}
