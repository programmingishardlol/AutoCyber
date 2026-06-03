create table public.profiles (
  id uuid primary key,
  email text
);

alter table public.profiles enable row level security;

create policy "public read" on public.profiles
for select using (true);

create table public.payments (
  id uuid primary key,
  user_id uuid not null,
  status text not null
);
