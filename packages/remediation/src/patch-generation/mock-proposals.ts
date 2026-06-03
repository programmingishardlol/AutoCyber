import type { FixProposal } from "@autocyber/core";

const now = "2026-05-28T09:00:00.000Z";

export const mockFixProposal: FixProposal = {
  id: "fix_mock_missing_auth",
  findingId: "finding_mock_missing_auth",
  repositoryId: "repo_mock",
  status: "draft",
  kind: "patch",
  title: "Mock proposal: gate API route with authentication",
  explanation: "A deterministic mock proposal for demos that should not be confused with scanner-backed rule output.",
  proposedPatch: "Add a server-side auth check before returning API data.",
  diff: "+ const { userId } = await auth();\n+ if (!userId) return new Response(\"Unauthorized\", { status: 401 });",
  risk: "Low. Mock proposal only; no repository files are changed.",
  verificationPlan: ["Rerun the scanner", "Confirm the missing-auth finding is gone"],
  filesChanged: ["app/api/example/route.ts"],
  createdAt: now,
  updatedAt: now
};
