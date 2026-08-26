CREATE TABLE IF NOT EXISTS "fix_decision_memories" (
  "id" text PRIMARY KEY NOT NULL,
  "team_id" text NOT NULL,
  "repository_id" text NOT NULL,
  "finding_fingerprint" text NOT NULL,
  "rule_id" text NOT NULL,
  "decision_type" text NOT NULL,
  "proposal_id" text,
  "finding_id" text,
  "rationale" text,
  "patch_hash" text,
  "recommended_fix_hash" text,
  "proposal_kind" text,
  "actor_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_fix_decision_memories_repo_fingerprint"
  ON "fix_decision_memories" ("repository_id", "finding_fingerprint");

CREATE INDEX IF NOT EXISTS "idx_fix_decision_memories_repo_rule"
  ON "fix_decision_memories" ("repository_id", "rule_id");

CREATE INDEX IF NOT EXISTS "idx_fix_decision_memories_repo_patch_hash"
  ON "fix_decision_memories" ("repository_id", "patch_hash");
