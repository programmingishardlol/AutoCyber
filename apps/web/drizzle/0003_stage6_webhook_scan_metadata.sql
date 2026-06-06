alter table public.scan_jobs
  add column if not exists webhook_delivery_id text,
  add column if not exists pull_request_number integer;
