alter table public.scan_jobs
  add column if not exists error text;
