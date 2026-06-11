update public.repositories
set
  connection_type = 'github_app',
  can_scan = 'true',
  can_monitor = 'true',
  can_open_pr = 'false',
  is_private = case
    when connection_type = 'public_github' then 'true'
    else is_private
  end,
  permissions_summary = coalesce(permissions_summary, '{}'::jsonb) || jsonb_build_object(
    'connectionStatus', 'connected',
    'githubAppPrCreationImplemented', false,
    'repairedInstalledCapabilities', true
  ),
  updated_at = now()
where provider = 'github'
  and installation_id is not null
  and (
    connection_type <> 'github_app'
    or can_scan <> 'true'
    or can_monitor <> 'true'
    or can_open_pr <> 'false'
    or (connection_type = 'public_github' and is_private <> 'true')
  );
