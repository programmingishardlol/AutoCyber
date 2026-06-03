create table if not exists users (
  id text primary key,
  clerk_user_id text not null unique,
  email text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teams (
  id text primary key,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists team_memberships (
  id text primary key,
  user_id text not null,
  team_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  team_id text not null,
  name text not null,
  slug text not null,
  description text not null,
  risk_score integer not null default 0,
  stage text not null,
  stack jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists repositories (
  id text primary key,
  project_id text not null,
  provider text not null,
  owner text not null,
  name text not null,
  default_branch text not null,
  url text not null,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists scan_jobs (
  id text primary key,
  repository_id text not null,
  status text not null,
  source text not null,
  branch text not null,
  commit_sha text not null,
  started_at timestamptz,
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists findings (
  id text primary key,
  scan_job_id text not null,
  repository_id text not null,
  rule_id text not null,
  title text not null,
  category text not null,
  severity text not null,
  confidence real not null,
  status text not null,
  stack_tags jsonb not null default '[]'::jsonb,
  affected_file text not null,
  evidence jsonb not null default '[]'::jsonb,
  risk_explanation text not null,
  remediation_summary text not null,
  verification_strategy text not null,
  autofix_available text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fix_proposals (
  id text primary key,
  finding_id text not null,
  repository_id text not null,
  status text not null,
  kind text not null,
  title text not null,
  explanation text not null,
  proposed_patch text not null,
  diff text not null,
  risk text not null,
  verification_plan jsonb not null default '[]'::jsonb,
  files_changed jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists verification_results (
  id text primary key,
  fix_proposal_id text not null,
  status text not null,
  scanner_rerun_status text not null,
  test_command text not null,
  test_output_summary text not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pull_requests (
  id text primary key,
  fix_proposal_id text not null,
  repository_id text not null,
  status text not null,
  branch_name text not null,
  title text not null,
  summary text not null,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  team_id text not null,
  actor text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists security_memories (
  id text primary key,
  team_id text not null,
  repository_id text not null,
  kind text not null,
  title text not null,
  content text not null,
  source text not null,
  confidence text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
