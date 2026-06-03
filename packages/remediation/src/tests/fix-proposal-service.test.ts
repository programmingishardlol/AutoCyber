import { describe, expect, it } from "vitest";
import { generateFixProposal, updateFixProposalStatus, type RemediationFinding } from "../index";

const baseFinding: RemediationFinding = {
  id: "finding_missing_auth",
  repositoryId: "repo_demo",
  ruleId: "missing-api-auth",
  title: "API route does not enforce authentication",
  category: "missing-auth",
  severity: "high",
  confidence: 0.84,
  status: "open",
  stackTags: ["nextjs", "clerk"],
  affectedFile: "app/api/admin/users/route.ts",
  evidence: [
    {
      filePath: "app/api/admin/users/route.ts",
      startLine: 1,
      endLine: 1,
      snippet: "export async function GET() { return NextResponse.json(await listUsers()); }"
    }
  ],
  riskExplanation: "Sensitive API routes without server-side user checks can expose data.",
  remediationSummary: "Require authentication before returning sensitive data.",
  verificationStrategy: "Rerun the missing-auth scanner rule.",
  autofixAvailable: true
};

describe("generateFixProposal", () => {
  it("generates a rule-based proposal for missing API authentication", () => {
    const proposal = generateFixProposal(baseFinding);

    expect(proposal.findingId).toBe(baseFinding.id);
    expect(proposal.repositoryId).toBe(baseFinding.repositoryId);
    expect(proposal.status).toBe("draft");
    expect(proposal.kind).toBe("patch");
    expect(proposal.filesChanged).toEqual(["app/api/admin/users/route.ts"]);
    expect(proposal.diff).toContain("+  const { userId } = await auth();");
    expect(proposal.explanation).toContain("server-side authentication");
  });

  it("returns a safe fallback proposal for unsupported findings", () => {
    const proposal = generateFixProposal({ ...baseFinding, id: "finding_unknown", ruleId: "dependency-risk-placeholder" });

    expect(proposal.title).toContain("Manual remediation plan");
    expect(proposal.diff).toContain("No automatic patch template is available");
    expect(proposal.risk).toContain("Manual review");
    expect(proposal.status).toBe("draft");
    expect(proposal.kind).toBe("advisory");
  });

  it("does not pretend exposed secrets can be rotated automatically", () => {
    const proposal = generateFixProposal({
      ...baseFinding,
      id: "finding_secret",
      ruleId: "exposed-secret",
      title: "Potential secret committed to repository",
      category: "exposed-secrets",
      affectedFile: ".env",
      remediationSummary: "Remove the secret from committed files."
    });

    expect(proposal.diff).toContain("OPENAI_API_KEY=");
    expect(proposal.explanation).toContain("rotate the leaked key manually");
    expect(proposal.explanation).not.toMatch(/auto(?:matically)? rotate/i);
    expect(proposal.verificationPlan.join("\n")).toContain("Rerun the exposed-secret scanner rule");
  });

  it("includes a verification plan", () => {
    const proposal = generateFixProposal(baseFinding);

    expect(proposal.verificationPlan.length).toBeGreaterThan(0);
    expect(proposal.verificationPlan.join("\n")).toContain("Rerun");
  });

  it("generates Stage 5B proposals for every selected startup-stack finding", () => {
    const ruleIds = [
      "next-public-sensitive-env",
      "ai-unsafe-prompt-logging",
      "ai-route-missing-rate-limit",
      "stripe-webhook-missing-construct-event",
      "supabase-service-role-in-client",
      "clerk-missing-org-authorization",
      "supabase-permissive-rls-policy"
    ];

    for (const ruleId of ruleIds) {
      const proposal = generateFixProposal(stage5Finding(ruleId));

      expect(proposal.title).not.toContain("Manual remediation plan");
      expect(proposal.explanation).not.toContain("does not have a deterministic patch template");
      expect(proposal.verificationPlan.length).toBeGreaterThan(0);
      expect(proposal.risk.length).toBeGreaterThan(20);
    }
  });

  it("creates a patch proposal for obvious AI prompt logging", () => {
    const proposal = generateFixProposal(
      stage5Finding("ai-unsafe-prompt-logging", {
        affectedFile: "app/api/chat/route.ts",
        evidenceSnippet: '  console.log("User prompt:", prompt);'
      })
    );

    expect(proposal.diff).toContain("--- a/app/api/chat/route.ts");
    expect(proposal.kind).toBe("patch");
    expect(proposal.diff).toContain('-  console.log("User prompt:", prompt);');
    expect(proposal.diff).toContain("+  // AutoCyber: removed raw prompt logging.");
    expect(proposal.proposedPatch).toContain("Remove the raw prompt/message log line");
    expect(proposal.verificationPlan.join("\n")).toContain("Rerun the ai-unsafe-prompt-logging scanner rule");
  });

  it("creates a patch proposal for env-style sensitive NEXT_PUBLIC names", () => {
    const proposal = generateFixProposal(
      stage5Finding("next-public-sensitive-env", {
        affectedFile: ".env.example",
        evidenceSnippet: "NEXT_PUBLIC_OPENAI_API_KEY="
      })
    );

    expect(proposal.diff).toContain("--- a/.env.example");
    expect(proposal.kind).toBe("patch");
    expect(proposal.diff).toContain("-NEXT_PUBLIC_OPENAI_API_KEY=");
    expect(proposal.diff).toContain("+OPENAI_API_KEY=");
    expect(proposal.proposedPatch).toContain("Rename the sensitive public environment variable");
  });

  it("keeps redacted env-style sensitive NEXT_PUBLIC findings advisory only", () => {
    const proposal = generateFixProposal(
      stage5Finding("next-public-sensitive-env", {
        affectedFile: ".env.example",
        evidenceSnippet: "NEXT_PUBLIC_OPENAI_API_KEY=[REDACTED]"
      })
    );

    expect(proposal.diff).toContain("# Advisory only");
    expect(proposal.kind).toBe("advisory");
    expect(proposal.diff).not.toContain("+++ b/");
    expect(proposal.proposedPatch).toContain("Manual remediation required");
  });

  it("keeps code-based NEXT_PUBLIC findings advisory only", () => {
    const proposal = generateFixProposal(
      stage5Finding("next-public-sensitive-env", {
        affectedFile: "components/ClientComponent.tsx",
        evidenceSnippet: "const key = process.env.NEXT_PUBLIC_OPENAI_API_KEY;"
      })
    );

    expect(proposal.diff).toContain("# Advisory only");
    expect(proposal.kind).toBe("advisory");
    expect(proposal.diff).not.toContain("+++ b/");
    expect(proposal.proposedPatch).toContain("Manual remediation required");
  });

  it("creates a guarded Stripe constructEvent patch for simple parsed JSON handlers", () => {
    const proposal = generateFixProposal(
      stage5Finding("stripe-webhook-missing-construct-event", {
        affectedFile: "app/api/stripe/webhook/route.ts",
        evidenceSnippet: "  const event = await req.json();"
      })
    );

    expect(proposal.diff).toContain("stripe.webhooks.constructEvent");
    expect(proposal.kind).toBe("patch");
    expect(proposal.diff).toContain("await req.text()");
    expect(proposal.diff).toContain("STRIPE_WEBHOOK_SECRET");
    expect(proposal.verificationPlan.join("\n")).toContain("unsigned webhook payload is rejected");
    expect(proposal.verificationPlan.join("\n")).toContain("signed webhook fixture");
  });

  it("keeps ambiguous Stage 5B remediation advisory only", () => {
    const advisoryRuleIds = [
      "ai-route-missing-rate-limit",
      "supabase-service-role-in-client",
      "clerk-missing-org-authorization",
      "supabase-permissive-rls-policy"
    ];

    for (const ruleId of advisoryRuleIds) {
      const proposal = generateFixProposal(stage5Finding(ruleId));

      expect(proposal.diff).toContain("# Advisory only");
      expect(proposal.kind).toBe("advisory");
      expect(proposal.diff).not.toContain("+++ b/");
      expect(proposal.proposedPatch).toContain("Manual remediation required");
    }
  });

  it("does not claim Stage 5B templates rotate secrets or perform provider-side changes automatically", () => {
    const text = [
      generateFixProposal(stage5Finding("next-public-sensitive-env")).explanation,
      generateFixProposal(stage5Finding("supabase-service-role-in-client")).explanation,
      generateFixProposal(stage5Finding("stripe-webhook-missing-construct-event")).explanation,
      generateFixProposal(stage5Finding("clerk-missing-org-authorization")).explanation,
      generateFixProposal(stage5Finding("supabase-permissive-rls-policy")).explanation
    ].join("\n");

    expect(text).not.toMatch(/auto(?:matically)? rotate/i);
    expect(text).not.toMatch(/AutoCyber will update (Supabase|Clerk|Stripe)/i);
    expect(text).not.toMatch(/guarantees? authorization/i);
  });
});

describe("updateFixProposalStatus", () => {
  it("updates approval and rejection status without changing proposal content", () => {
    const proposal = generateFixProposal(baseFinding);
    const approved = updateFixProposalStatus(proposal, "approved");
    const rejected = updateFixProposalStatus(proposal, "rejected");

    expect(approved.status).toBe("approved");
    expect(rejected.status).toBe("rejected");
    expect(approved.diff).toBe(proposal.diff);
    expect(rejected.filesChanged).toEqual(proposal.filesChanged);
  });
});

function stage5Finding(
  ruleId: string,
  overrides: {
    affectedFile?: string;
    evidenceSnippet?: string;
  } = {}
): RemediationFinding {
  const affectedFile = overrides.affectedFile ?? "app/api/demo/route.ts";
  return {
    ...baseFinding,
    id: `finding_${ruleId}`,
    ruleId,
    title: `Stage 5 finding ${ruleId}`,
    category: ruleId,
    severity: ruleId.includes("permissive") || ruleId.includes("route-missing") ? "medium" : "high",
    confidence: 0.72,
    stackTags: ["nextjs", "supabase", "clerk", "stripe", "openai", "anthropic"],
    affectedFile,
    evidence: [
      {
        filePath: affectedFile,
        startLine: 1,
        endLine: 1,
        snippet: overrides.evidenceSnippet ?? "const event = await request.json();"
      }
    ],
    riskExplanation: "The startup-stack pattern can expose data, credentials, or tenant boundaries.",
    remediationSummary: "Apply the recommended startup-stack remediation.",
    verificationStrategy: `Rerun the ${ruleId} scanner rule.`,
    autofixAvailable: false
  };
}
