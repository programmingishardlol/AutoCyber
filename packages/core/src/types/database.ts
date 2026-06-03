export const databaseTables = [
  "users",
  "teams",
  "team_memberships",
  "projects",
  "repositories",
  "scan_jobs",
  "findings",
  "fix_proposals",
  "verification_results",
  "pull_requests",
  "integrations",
  "security_memories",
  "workflow_playbooks",
  "audit_logs"
] as const;

export type DatabaseTable = (typeof databaseTables)[number];

export const stageZeroSchemaNotes: Record<DatabaseTable, string> = {
  users: "Clerk-backed user records; raw Clerk secrets are never stored here.",
  teams: "Tenant boundary for future Clerk organizations and Supabase RLS.",
  team_memberships: "Associates users with teams without overbuilding roles.",
  projects: "Customer-facing app or product under security review.",
  repositories: "Source repository metadata; no integration tokens are stored here.",
  scan_jobs: "Historical scan execution records and normalized summary counts.",
  findings: "Normalized security issues with evidence and remediation guidance.",
  fix_proposals: "Human-reviewable remediation plans and diff previews.",
  verification_results: "Scanner rerun and test evidence for approved fixes.",
  pull_requests: "PR metadata only; real creation starts in Stage 4.",
  integrations: "Connection state for startup-stack providers.",
  security_memories: "Repo-aware decisions, false positives, and preferences.",
  workflow_playbooks: "Opinionated secure workflow templates.",
  audit_logs: "Team-scoped activity trail for trust and accountability."
};
