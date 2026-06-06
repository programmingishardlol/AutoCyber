alter table repositories
  add column if not exists connection_type text not null default 'local',
  add column if not exists can_scan text not null default 'true',
  add column if not exists can_monitor text not null default 'false',
  add column if not exists can_open_pr text not null default 'false',
  add column if not exists permissions_summary jsonb not null default '{}'::jsonb;
