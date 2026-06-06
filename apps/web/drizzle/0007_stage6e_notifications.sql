create table if not exists public.notifications (
  id text primary key,
  team_id text not null,
  repository_id text not null,
  scan_job_id text,
  finding_id text,
  type text not null,
  severity text not null,
  title text not null,
  message text not null,
  status text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
