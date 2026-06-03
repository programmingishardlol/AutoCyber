import type { FixProposal, StackTag } from "@autocyber/core";

export interface ProposalFindingContext {
  ruleId?: string;
  category: string;
  stackTags: StackTag[];
  affectedFile: string;
  remediationSummary: string;
  verificationStrategy?: string;
}

export interface StackFindingDisplay {
  stack: StackTag;
  label: string;
  description: string;
}

export interface FixProposalDisplay {
  kind: "patch" | "advisory";
  label: string;
  summary: string;
  tone: "green" | "orange";
  diffTitle: string;
  diffDescription: string;
  actionDisabledReason: string | null;
  whyAutoCyberCannotPatch: string | null;
  manualSteps: string[];
}

const stackCopy: Partial<Record<StackTag, { label: string; description: string }>> = {
  supabase: {
    label: "Supabase data boundary",
    description: "Check RLS, client/server key usage, and tenant-scoped access before applying any fix."
  },
  vercel: {
    label: "Vercel deployment config",
    description: "Review public environment names, security headers, and platform config that can affect every deployment."
  },
  nextjs: {
    label: "Next.js app boundary",
    description: "Separate client components from server-only secrets, auth checks, and route-handler security controls."
  },
  clerk: {
    label: "Clerk auth boundary",
    description: "Confirm both signed-in user checks and organization, role, or permission checks on sensitive routes."
  },
  stripe: {
    label: "Stripe payment boundary",
    description: "Preserve payment semantics while validating webhook signatures and avoiding client-trusted payment state."
  },
  openai: {
    label: "OpenAI usage boundary",
    description: "Keep provider keys server-side, avoid raw prompt logs, and add abuse controls around model calls."
  },
  anthropic: {
    label: "Anthropic usage boundary",
    description: "Keep provider keys server-side, avoid raw prompt logs, and add abuse controls around model calls."
  }
};

export function getFixProposalDisplay(proposal: FixProposal, finding?: ProposalFindingContext): FixProposalDisplay {
  const kind = getFixProposalKind(proposal);

  if (kind === "patch") {
    return {
      kind,
      label: "Patchable proposal",
      summary: "AutoCyber has a narrow unified diff that can be reviewed, approved, applied to a temporary copy, and verified.",
      tone: "green",
      diffTitle: "Patch preview",
      diffDescription: "Review the exact files and lines AutoCyber proposes to change before approving remediation.",
      actionDisabledReason: null,
      whyAutoCyberCannotPatch: null,
      manualSteps: []
    };
  }

  return {
    kind,
    label: "Advisory-only proposal",
    summary: "Manual remediation required. AutoCyber can explain the issue and verification plan, but it will not invent a risky app-specific patch.",
    tone: "orange",
    diffTitle: "Advisory note",
    diffDescription: "This is not an applyable patch. Use the manual steps and verification plan before rerunning AutoCyber.",
    actionDisabledReason: "Local remediation and GitHub PR creation are disabled until a human supplies an applyable patch and verification passes.",
    whyAutoCyberCannotPatch: getAdvisoryReason(finding),
    manualSteps: getManualSteps(finding)
  };
}

export function getFixProposalKind(proposal: FixProposal): FixProposal["kind"] {
  if (proposal.kind) return proposal.kind;

  const normalized = proposal.diff.trimStart();
  return normalized.startsWith("# Advisory only") || !normalized.includes("--- ") || !normalized.includes("+++ ") ? "advisory" : "patch";
}

export function getFindingStackDisplay(finding: ProposalFindingContext): StackFindingDisplay[] {
  return finding.stackTags
    .filter((stack): stack is keyof typeof stackCopy => Boolean(stackCopy[stack]))
    .map((stack) => ({
      stack,
      label: stackCopy[stack]!.label,
      description: stackCopy[stack]!.description
    }));
}

function getAdvisoryReason(finding: ProposalFindingContext | undefined): string {
  if (!finding) {
    return "The finding needs application context that is not present in the normalized scanner output.";
  }

  const ruleId = finding.ruleId ?? finding.category;

  if (ruleId.includes("rate-limit")) {
    return "Rate limits depend on your identity model, storage backend, quotas, and product abuse policy. A generic dependency or limiter could fail open or block legitimate users.";
  }

  if (ruleId.includes("supabase-service-role")) {
    return "Moving Supabase service-role operations requires knowing the server-only boundary and the authorization checks that should protect privileged data access.";
  }

  if (ruleId.includes("supabase-permissive-rls")) {
    return "RLS policies need the correct tenant, owner, or role predicate for your schema. Guessing that predicate can either leak data or cause an outage.";
  }

  if (ruleId.includes("clerk-missing-org")) {
    return "Organization authorization depends on the requested org/team identifier and the Clerk role or permission model used by this app.";
  }

  if (ruleId.includes("next-public-sensitive-env")) {
    return "Removing a public secret from client code often requires moving behavior behind a server route or server action, which is app-specific.";
  }

  if (ruleId.includes("stripe-webhook")) {
    return "The webhook handler shape is too ambiguous for a deterministic patch without risking changes to payment fulfillment behavior.";
  }

  return "The scanner found a real risk, but AutoCyber does not have enough exact code context to safely produce a narrow patch.";
}

function getManualSteps(finding: ProposalFindingContext | undefined): string[] {
  if (!finding) {
    return ["Review the evidence manually.", "Apply the scanner recommendation.", "Rerun AutoCyber and relevant app tests."];
  }

  const ruleId = finding.ruleId ?? finding.category;

  if (ruleId.includes("ai-route-missing-rate-limit")) {
    return [
      "Choose the rate-limit key: authenticated user id first, then IP fallback for anonymous routes.",
      "Add quota or throttle checks before calling OpenAI or Anthropic.",
      "Return a clear 429 response when the limit is exceeded.",
      "Rerun the scanner and exercise the route above and below the configured limit."
    ];
  }

  if (ruleId.includes("supabase-service-role")) {
    return [
      "Move service-role Supabase operations into server-only routes, jobs, or admin scripts.",
      "Use the anon key in browser/client code and enforce user or organization authorization server-side.",
      "Rotate any service-role key that may have reached client code.",
      "Rerun the scanner and inspect the browser bundle for service-role references."
    ];
  }

  if (ruleId.includes("supabase-permissive-rls")) {
    return [
      "Replace broad predicates such as `using (true)` with owner, organization, or role-scoped predicates.",
      "Test anon and authenticated Supabase roles against the affected table.",
      "Confirm users can only access rows that match the intended tenant or ownership model.",
      "Rerun the scanner and review the migration before deployment."
    ];
  }

  if (ruleId.includes("clerk-missing-org")) {
    return [
      "Identify the requested organization, workspace, team, or admin scope for the route.",
      "Compare it with Clerk `orgId`, role, permission, or membership context.",
      "Reject cross-organization access and unauthorized roles before returning data.",
      "Test with an unauthorized org member and an authorized admin/member."
    ];
  }

  if (ruleId.includes("next-public-sensitive-env")) {
    return [
      "Move secret-dependent behavior behind a server route, server action, or server component.",
      "Replace sensitive `NEXT_PUBLIC_*` names with server-only environment variables.",
      "Expose only non-sensitive derived values to browser code.",
      "Rerun the scanner and confirm the secret is not present in client bundles."
    ];
  }

  if (ruleId.includes("stripe-webhook")) {
    return [
      "Read the raw request body before parsing the event.",
      "Validate the `stripe-signature` header with `stripe.webhooks.constructEvent`.",
      "Configure `STRIPE_WEBHOOK_SECRET` in every deployment environment.",
      "Test unsigned and signed webhook fixtures before enabling PR remediation."
    ];
  }

  return [
    finding.remediationSummary,
    finding.verificationStrategy ?? "Rerun AutoCyber after the manual remediation.",
    "Run relevant typecheck, tests, or app smoke checks for the affected area."
  ];
}
