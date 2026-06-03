create table public.profiles (
  id uuid primary key,
  owner_id text not null,
  email text
);

alter table public.profiles enable row level security;

create policy "owner read" on public.profiles
for select using (auth.uid()::text = owner_id);
