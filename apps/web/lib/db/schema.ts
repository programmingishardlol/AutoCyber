import { integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  ...timestamps
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps
});

export const teamMemberships = pgTable("team_memberships", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  teamId: text("team_id").notNull(),
  ...timestamps
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull(),
  riskScore: integer("risk_score").notNull().default(0),
  stage: text("stage").notNull(),
  stack: jsonb("stack").$type<string[]>().notNull().default([]),
  ...timestamps
});

export const repositories = pgTable("repositories", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  provider: text("provider").notNull(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  defaultBranch: text("default_branch").notNull(),
  url: text("url").notNull(),
  installationId: text("installation_id"),
  isPrivate: text("is_private").notNull().default("false"),
  connectionType: text("connection_type").notNull().default("local"),
  canScan: text("can_scan").notNull().default("true"),
  canMonitor: text("can_monitor").notNull().default("false"),
  canOpenPr: text("can_open_pr").notNull().default("false"),
  permissionsSummary: jsonb("permissions_summary").$type<Record<string, string | boolean | null>>().notNull().default({}),
  lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
  ...timestamps
});

export const scanJobs = pgTable("scan_jobs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull(),
  status: text("status").notNull(),
  source: text("source").notNull(),
  branch: text("branch").notNull(),
  commitSha: text("commit_sha").notNull(),
  webhookDeliveryId: text("webhook_delivery_id"),
  pullRequestNumber: integer("pull_request_number"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  summary: jsonb("summary").$type<Record<string, number>>().notNull()
});

export const findings = pgTable("findings", {
  id: text("id").primaryKey(),
  scanJobId: text("scan_job_id").notNull(),
  repositoryId: text("repository_id").notNull(),
  ruleId: text("rule_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status").notNull(),
  stackTags: jsonb("stack_tags").$type<string[]>().notNull().default([]),
  affectedFile: text("affected_file").notNull(),
  evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
  riskExplanation: text("risk_explanation").notNull(),
  remediationSummary: text("remediation_summary").notNull(),
  verificationStrategy: text("verification_strategy").notNull(),
  autofixAvailable: text("autofix_available").notNull(),
  ...timestamps
});

export const fixProposals = pgTable("fix_proposals", {
  id: text("id").primaryKey(),
  findingId: text("finding_id").notNull(),
  repositoryId: text("repository_id").notNull(),
  status: text("status").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  proposedPatch: text("proposed_patch").notNull(),
  diff: text("diff").notNull(),
  risk: text("risk").notNull(),
  verificationPlan: jsonb("verification_plan").$type<string[]>().notNull().default([]),
  filesChanged: jsonb("files_changed").$type<string[]>().notNull().default([]),
  ...timestamps
});

export const verificationResults = pgTable("verification_results", {
  id: text("id").primaryKey(),
  fixProposalId: text("fix_proposal_id").notNull(),
  status: text("status").notNull(),
  scannerRerunStatus: text("scanner_rerun_status").notNull(),
  testCommand: text("test_command").notNull(),
  testOutputSummary: text("test_output_summary").notNull(),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  ...timestamps
});

export const pullRequests = pgTable("pull_requests", {
  id: text("id").primaryKey(),
  fixProposalId: text("fix_proposal_id").notNull(),
  repositoryId: text("repository_id").notNull(),
  status: text("status").notNull(),
  branchName: text("branch_name").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  url: text("url"),
  ...timestamps
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const securityMemories = pgTable("security_memories", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  repositoryId: text("repository_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  source: text("source").notNull(),
  confidence: text("confidence").notNull(),
  ...timestamps
});

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  repositoryId: text("repository_id").notNull(),
  scanJobId: text("scan_job_id"),
  findingId: text("finding_id"),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(),
  ...timestamps
});
