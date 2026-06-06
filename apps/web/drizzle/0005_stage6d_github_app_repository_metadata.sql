alter table public.repositories
  add column if not exists installation_id text,
  add column if not exists is_private text not null default 'false';
