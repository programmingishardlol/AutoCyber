import { describe, expect, it } from "vitest";
import type { FixProposal } from "@autocyber/core";
import { getFindingStackDisplay, getFixProposalDisplay, getFixProposalKind, type ProposalFindingContext } from "./fix-proposal-display";

const patchProposal: FixProposal = {
  id: "fix_patch",
  findingId: "finding_patch",
  repositoryId: "repo_demo",
  status: "draft",
  kind: "patch",
  title: "Remove raw AI prompt logging",
  explanation: "Remove unsafe prompt logging.",
  proposedPatch: "Remove raw prompt logging.",
  diff: `--- a/app/api/chat/route.ts
+++ b/app/api/chat/route.ts
@@
-  console.log("User prompt:", prompt);
+  // AutoCyber: removed raw prompt logging.`,
  risk: "Low.",
  verificationPlan: ["Rerun the scanner."],
  filesChanged: ["app/api/chat/route.ts"],
  createdAt: "2026-05-30T10:00:00.000Z",
  updatedAt: "2026-05-30T10:00:00.000Z"
};

const advisoryProposal: FixProposal = {
  ...patchProposal,
  id: "fix_advisory",
  kind: "advisory",
  title: "Add rate limiting to AI route",
  proposedPatch: "Manual remediation required: add authenticated user or IP-based rate limits.",
  diff: "# Advisory only: no automatic patch is safe for ai-route-missing-rate-limit."
};

const aiFinding: ProposalFindingContext = {
  ruleId: "ai-route-missing-rate-limit",
  category: "ai-security",
  stackTags: ["nextjs", "openai", "anthropic"],
  affectedFile: "app/api/chat/route.ts",
  remediationSummary: "Add rate limits before calling model providers.",
  verificationStrategy: "Rerun the AI rate-limit scanner rule."
};

describe("fix proposal display helpers", () => {
  it("identifies patchable proposals and keeps remediation enabled", () => {
    const display = getFixProposalDisplay(patchProposal, aiFinding);

    expect(getFixProposalKind(patchProposal)).toBe("patch");
    expect(display.kind).toBe("patch");
    expect(display.label).toBe("Patchable proposal");
    expect(display.diffTitle).toBe("Patch preview");
    expect(display.actionDisabledReason).toBeNull();
    expect(display.manualSteps).toEqual([]);
  });

  it("identifies advisory proposals with manual steps and disabled remediation reason", () => {
    const display = getFixProposalDisplay(advisoryProposal, aiFinding);

    expect(getFixProposalKind(advisoryProposal)).toBe("advisory");
    expect(display.kind).toBe("advisory");
    expect(display.label).toBe("Advisory-only proposal");
    expect(display.diffTitle).toBe("Advisory note");
    expect(display.actionDisabledReason).toContain("disabled");
    expect(display.whyAutoCyberCannotPatch).toContain("Rate limits depend");
    expect(display.manualSteps.join("\n")).toContain("429");
  });

  it("falls back to diff shape for older proposal records without kind metadata", () => {
    const legacyPatch = { ...patchProposal, kind: undefined } as unknown as FixProposal;
    const legacyAdvisory = { ...advisoryProposal, kind: undefined } as unknown as FixProposal;

    expect(getFixProposalKind(legacyPatch)).toBe("patch");
    expect(getFixProposalKind(legacyAdvisory)).toBe("advisory");
  });

  it("returns startup-stack context for Stage 5 findings", () => {
    const contexts = getFindingStackDisplay(aiFinding);

    expect(contexts.map((context) => context.stack)).toEqual(["nextjs", "openai", "anthropic"]);
    expect(contexts[0]?.description).toContain("client components");
    expect(contexts[1]?.label).toBe("OpenAI usage boundary");
  });
});
