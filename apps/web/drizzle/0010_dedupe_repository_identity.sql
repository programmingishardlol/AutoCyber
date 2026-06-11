create temp table if not exists repository_dedupe_map (
  old_id text primary key,
  canonical_id text not null
) on commit drop;

truncate table repository_dedupe_map;

insert into repository_dedupe_map (old_id, canonical_id)
with ranked as (
  select
    id,
    first_value(id) over (
      partition by provider, lower(owner), lower(name)
      order by
        case
          when connection_type = 'github_app'
            and installation_id is not null
            and coalesce(permissions_summary->>'connectionStatus', 'connected') <> 'disconnected'
            then 0
          when connection_type = 'github_app' and installation_id is not null then 1
          when connection_type = 'token_dev' then 2
          when connection_type = 'public_github' then 3
          else 4
        end,
        last_scanned_at desc nulls last,
        updated_at desc,
        created_at desc
    ) as canonical_id
  from public.repositories
  where provider = 'github'
)
select id, canonical_id
from ranked
where id <> canonical_id;

with aggregate_values as (
  select
    map.canonical_id,
    max(repo.last_scanned_at) as last_scanned_at,
    max(repo.created_at) as created_at,
    max(repo.updated_at) as updated_at
  from repository_dedupe_map map
  join public.repositories repo on repo.id = map.old_id or repo.id = map.canonical_id
  group by map.canonical_id
)
update public.repositories repo
set
  last_scanned_at = case
    when repo.last_scanned_at is null then aggregate_values.last_scanned_at
    when aggregate_values.last_scanned_at is null then repo.last_scanned_at
    else greatest(repo.last_scanned_at, aggregate_values.last_scanned_at)
  end,
  created_at = greatest(repo.created_at, aggregate_values.created_at),
  updated_at = greatest(repo.updated_at, aggregate_values.updated_at, now())
from aggregate_values
where repo.id = aggregate_values.canonical_id;

update public.scan_jobs scan_job
set repository_id = map.canonical_id
from repository_dedupe_map map
where scan_job.repository_id = map.old_id;

update public.findings finding
set repository_id = map.canonical_id
from repository_dedupe_map map
where finding.repository_id = map.old_id;

update public.fix_proposals proposal
set repository_id = map.canonical_id
from repository_dedupe_map map
where proposal.repository_id = map.old_id;

update public.pull_requests pull_request
set repository_id = map.canonical_id
from repository_dedupe_map map
where pull_request.repository_id = map.old_id;

update public.notifications notification
set repository_id = map.canonical_id
from repository_dedupe_map map
where notification.repository_id = map.old_id;

update public.security_memories memory
set repository_id = map.canonical_id
from repository_dedupe_map map
where memory.repository_id = map.old_id;

update public.audit_logs audit_log
set target_id = map.canonical_id
from repository_dedupe_map map
where audit_log.target_type = 'repository'
  and audit_log.target_id = map.old_id;

delete from public.repositories repo
using repository_dedupe_map map
where repo.id = map.old_id;

create unique index if not exists repositories_github_identity_unique
  on public.repositories (provider, lower(owner), lower(name))
  where provider = 'github';
