ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS occurrence_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS previous_finding_id text,
  ADD COLUMN IF NOT EXISTS memory_status text NOT NULL DEFAULT 'none';

UPDATE findings
SET
  first_seen_at = COALESCE(first_seen_at, created_at),
  last_seen_at = COALESCE(last_seen_at, created_at),
  fingerprint = COALESCE(
    fingerprint,
    'legacy_' || md5(repository_id || ':' || rule_id || ':' || affected_file || ':' || id)
  )
WHERE first_seen_at IS NULL OR last_seen_at IS NULL OR fingerprint IS NULL;

CREATE INDEX IF NOT EXISTS findings_repository_fingerprint_idx
  ON findings (repository_id, fingerprint);

CREATE INDEX IF NOT EXISTS findings_lifecycle_status_idx
  ON findings (repository_id, lifecycle_status);
