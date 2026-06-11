create table if not exists public.github_installations (
  id text primary key,
  installation_id text not null unique,
  team_id text not null,
  user_id text not null,
  account_login text not null,
  account_type text not null,
  status text not null default 'connected',
  repository_selection text not null default 'selected',
  repository_count integer not null default 0,
  permissions_summary jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.github_installations enable row level security;
revoke all on table public.github_installations from anon, authenticated;
