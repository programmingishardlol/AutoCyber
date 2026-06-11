#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

const safeInvalidScanError = "Invalidated: fixture content was scanned under the wrong GitHub repository.";
const defaultEnvFile = ".env.local";

const args = parseArgs(process.argv.slice(2));
if (args.scanIds.length === 0) {
  console.error("Usage: node scripts/cleanup-invalid-scan-records.mjs --scan-id <scan_id> [--scan-id <scan_id>] --reason <reason>");
  process.exit(1);
}

if (!args.reason) {
  console.error("Cleanup requires --reason so the audit log explains why the records were invalidated.");
  process.exit(1);
}

loadEnvFile(args.envFile ?? defaultEnvFile);
const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL or SUPABASE_DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

try {
  const result = await cleanupInvalidScans(sql, args.scanIds, args.reason);
  console.log(
    JSON.stringify(
      {
        status: "cleanup_applied",
        scanIds: result.scanIds,
        repositories: result.repositories,
        notificationsDismissed: result.notificationsDismissed,
        findingsMarkedFalsePositive: result.findingsMarkedFalsePositive,
        scanJobsInvalidated: result.scanJobsInvalidated,
        note: "Security memory rows are unchanged because current repo-profile memories do not store source scan ids."
      },
      null,
      2
    )
  );
} finally {
  await sql.end();
}

async function cleanupInvalidScans(sql, scanIds, reason) {
  const scanRows = await sql`
    select scan_jobs.id, scan_jobs.repository_id, repositories.owner, repositories.name
    from scan_jobs
    join repositories on repositories.id = scan_jobs.repository_id
    where scan_jobs.id = any(${scanIds})
  `;

  const foundScanIds = new Set(scanRows.map((row) => row.id));
  const missingScanIds = scanIds.filter((scanId) => !foundScanIds.has(scanId));
  if (missingScanIds.length > 0) {
    throw new Error(`Refusing cleanup because these explicit scan ids were not found: ${missingScanIds.join(", ")}`);
  }

  const repositoryIds = [...new Set(scanRows.map((row) => row.repository_id))];
  const repositoryNames = [...new Set(scanRows.map((row) => `${row.owner}/${row.name}`))];
  const now = new Date();

  await sql.begin(async (transaction) => {
    for (const scanId of scanIds) {
      await transaction`
        insert into audit_logs (id, team_id, actor, action, target_type, target_id, created_at)
        values (${createId("audit")}, 'team_dev', 'autocyber_cleanup', 'invalid_scan_cleanup_started', 'scan_job', ${scanId}, ${now})
      `;
      await transaction`
        insert into audit_logs (id, team_id, actor, action, target_type, target_id, created_at)
        values (${createId("audit")}, 'team_dev', 'autocyber_cleanup', ${`invalid_scan_cleanup_reason:${reason}`}, 'scan_job', ${scanId}, ${now})
      `;
    }

    await transaction`
      update notifications
      set status = 'dismissed', updated_at = ${now}
      where scan_job_id = any(${scanIds})
    `;

    await transaction`
      update findings
      set status = 'false_positive', updated_at = ${now}
      where scan_job_id = any(${scanIds})
    `;

    await transaction`
      update scan_jobs
      set status = 'failed', error = ${safeInvalidScanError}, completed_at = ${now}
      where id = any(${scanIds})
    `;

    for (const repositoryId of repositoryIds) {
      await transaction`
        update repositories
        set last_scanned_at = (
          select max(completed_at)
          from scan_jobs
          where repository_id = ${repositoryId}
            and status = 'completed'
        ),
        updated_at = ${now}
        where id = ${repositoryId}
      `;
      await transaction`
        insert into audit_logs (id, team_id, actor, action, target_type, target_id, created_at)
        values (${createId("audit")}, 'team_dev', 'autocyber_cleanup', 'repository_last_scanned_recomputed_after_invalid_scan_cleanup', 'repository', ${repositoryId}, ${now})
      `;
    }
  });

  const [notificationCount] = await sql`
    select count(*)::int as count
    from notifications
    where scan_job_id = any(${scanIds})
      and status = 'dismissed'
  `;
  const [findingCount] = await sql`
    select count(*)::int as count
    from findings
    where scan_job_id = any(${scanIds})
      and status = 'false_positive'
  `;
  const [scanJobCount] = await sql`
    select count(*)::int as count
    from scan_jobs
    where id = any(${scanIds})
      and status = 'failed'
      and error = ${safeInvalidScanError}
  `;

  return {
    scanIds,
    repositories: repositoryNames,
    notificationsDismissed: notificationCount?.count ?? 0,
    findingsMarkedFalsePositive: findingCount?.count ?? 0,
    scanJobsInvalidated: scanJobCount?.count ?? 0
  };
}

function parseArgs(argv) {
  const parsed = {
    scanIds: [],
    reason: "",
    envFile: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scan-id") {
      const scanId = argv[index + 1]?.trim();
      if (!scanId) throw new Error("--scan-id requires a value.");
      parsed.scanIds.push(scanId);
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      parsed.reason = argv[index + 1]?.trim() ?? "";
      index += 1;
      continue;
    }
    if (arg === "--env-file") {
      parsed.envFile = argv[index + 1]?.trim() ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key && process.env[key] === undefined) {
      process.env[key] = value?.trim() ?? "";
    }
  }
}

function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
