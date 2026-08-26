import { createLocalScanner, type ScannerResult } from "@autocyber/scanner";
import type {
  NotificationType,
  Repository,
  ScanJob,
  Severity,
} from "@autocyber/core";
import { GitHubAppAuthError } from "./github-app-auth";
import {
  clonePublicGitHubRepository,
  GitHubIngestionError,
} from "./github-ingestion";
import { cloneGitHubRepositoryWithInstallationToken } from "./github-private-ingestion";
import {
  classifyFindingLifecycle,
  summarizeFindingLifecycle,
} from "./finding-lifecycle";
import type { PersistenceStore } from "./persistence/store";
import { formatPriorityBand, scoreFindingPriority } from "./priority-scoring";
import { normalizeScannerResultForContext } from "./scan-result-context";

type FindingSummary = ScanJob["summary"];

export interface EnqueueScanJobInput {
  repositoryId: string;
  source: ScanJob["source"];
  branch: string;
  commitSha: string;
  webhookDeliveryId?: string | null;
  pullRequestNumber?: number | null;
}

export interface ProcessScanJobOptions {
  scanRepositoryPath?: (
    repositoryPath: string,
    repositoryId: string,
    scanJobId: string,
  ) => Promise<ScannerResult>;
  fetchPublicGitHubRepository?: (input: {
    repository: Repository;
    scan(repositoryPath: string): Promise<ScannerResult>;
  }) => Promise<ScannerResult>;
  fetchPrivateGitHubRepository?: (input: {
    repository: Repository;
    scan(repositoryPath: string): Promise<ScannerResult>;
  }) => Promise<ScannerResult>;
}

export type ProcessScanJobResult =
  | { status: "completed"; scanJobId: string; findings: number }
  | { status: "failed"; scanJobId: string; error: string };

export interface ProcessQueuedScanJobsOptions extends ProcessScanJobOptions {
  limit?: number;
}

export interface ProcessQueuedScanJobsResult {
  requestedLimit: number;
  processed: number;
  completed: number;
  failed: number;
  remainingQueued: number;
  results: ProcessScanJobResult[];
}

const safeMonitoringScanError =
  "AutoCyber could not complete the monitoring scan.";
const defaultQueueProcessLimit = 5;
const maxQueueProcessLimit = 10;

export async function enqueueScanJob(
  store: PersistenceStore,
  input: EnqueueScanJobInput,
): Promise<ScanJob> {
  return store.createScanJob({
    repositoryId: input.repositoryId,
    source: input.source,
    branch: input.branch,
    commitSha: input.commitSha,
    webhookDeliveryId: input.webhookDeliveryId ?? null,
    pullRequestNumber: input.pullRequestNumber ?? null,
    status: "queued",
  });
}

export async function processScanJob(
  store: PersistenceStore,
  scanJobId: string,
  options: ProcessScanJobOptions = {},
): Promise<ProcessScanJobResult> {
  const scanJob = await store.getScanJob(scanJobId);
  if (!scanJob) {
    return {
      status: "failed",
      scanJobId,
      error: "Scan job was not found.",
    };
  }

  const repository = await store.getRepository(scanJob.repositoryId);
  if (!repository) {
    await store.failScanJob(
      scanJob.id,
      "Repository was not found for this monitoring scan.",
    );
    await store.writeAuditLog("monitoring_scan_failed", "scan_job", scanJob.id);
    return {
      status: "failed",
      scanJobId: scanJob.id,
      error: "Repository was not found for this monitoring scan.",
    };
  }

  await store.markScanJobRunning(scanJob.id);
  await store.writeAuditLog("monitoring_scan_started", "scan_job", scanJob.id);

  try {
    const rawResult = await runScannerForRepository(
      scanJob,
      repository,
      options,
    );
    const result = normalizeScannerResultForContext(rawResult, {
      repositoryId: repository.id,
      scanJobId: scanJob.id,
    });
    const previousFindings = await store.listFindings();
    const falsePositiveFingerprints = await store.listFalsePositiveFingerprints(
      repository.id,
    );
    const lifecycle = classifyFindingLifecycle({
      repositoryId: repository.id,
      scanJobId: scanJob.id,
      currentFindings: result.findings,
      previousFindings,
      falsePositiveFingerprints,
    });
    const findings = [
      ...lifecycle.currentFindings,
      ...lifecycle.resolvedFindings,
    ];
    await store.saveFindings(findings);
    await store.upsertRepoProfileMemory(
      result.repositoryId,
      result.projectProfile,
    );
    await store.completeScanJob(result.scanJobId, summarizeFindings(findings));
    await store.writeAuditLog(
      "monitoring_scan_completed",
      "scan_job",
      scanJob.id,
    );
    await createCompletionNotifications(
      store,
      scanJob,
      repository,
      lifecycle.currentFindings,
    );

    return {
      status: "completed",
      scanJobId: scanJob.id,
      findings: findings.length,
    };
  } catch (error) {
    const message =
      error instanceof GitHubIngestionError ||
      error instanceof GitHubAppAuthError
        ? error.message
        : safeMonitoringScanError;
    await store.failScanJob(scanJob.id, message);
    await store.writeAuditLog("monitoring_scan_failed", "scan_job", scanJob.id);
    await createFailureNotifications(store, scanJob, repository, message);

    return {
      status: "failed",
      scanJobId: scanJob.id,
      error: message,
    };
  }
}

export async function processQueuedScanJobs(
  store: PersistenceStore,
  options: ProcessQueuedScanJobsOptions = {},
): Promise<ProcessQueuedScanJobsResult> {
  const requestedLimit = normalizeQueueProcessLimit(options.limit);
  const scanJobs = await store.listScanJobs();
  const queuedJobs = scanJobs.filter((scanJob) => scanJob.status === "queued");
  const selectedJobs = queuedJobs.slice(0, requestedLimit);
  const results: ProcessScanJobResult[] = [];

  await store.writeAuditLog(
    "scan_queue_worker_started",
    "scan_queue",
    "queued",
  );

  for (const scanJob of selectedJobs) {
    results.push(await processScanJob(store, scanJob.id, options));
  }

  const latestScanJobs = await store.listScanJobs();
  const remainingQueued = latestScanJobs.filter(
    (scanJob) => scanJob.status === "queued",
  ).length;
  await store.writeAuditLog(
    "scan_queue_worker_completed",
    "scan_queue",
    "queued",
  );

  return {
    requestedLimit,
    processed: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    failed: results.filter((result) => result.status === "failed").length,
    remainingQueued,
    results,
  };
}

async function createFailureNotifications(
  store: PersistenceStore,
  scanJob: ScanJob,
  repository: Repository,
  message: string,
): Promise<void> {
  await store.createNotification({
    repositoryId: repository.id,
    scanJobId: scanJob.id,
    findingId: null,
    type: "scan_failed",
    severity: "high",
    title: "Monitoring scan failed",
    message: sanitizeNotificationText(
      `AutoCyber could not complete a ${scanJob.source} monitoring scan for ${repository.owner}/${repository.name}. ${message}`,
    ),
  });

  if (
    message === "Private repository scanning requires GitHub App installation."
  ) {
    await store.createNotification({
      repositoryId: repository.id,
      scanJobId: scanJob.id,
      findingId: null,
      type: "private_repo_fetch_failed",
      severity: "high",
      title: "Private repository fetch failed",
      message:
        "Private repository scanning requires GitHub App installation before AutoCyber can fetch the repository for monitoring.",
    });
  }
}

async function createCompletionNotifications(
  store: PersistenceStore,
  scanJob: ScanJob,
  repository: Repository,
  findings: ScannerResult["findings"],
): Promise<void> {
  if (scanJob.source === "pull_request") {
    await store.createNotification({
      repositoryId: repository.id,
      scanJobId: scanJob.id,
      findingId: null,
      type: "pull_request_scan_completed",
      severity: "info",
      title: "Pull request scan completed",
      message: sanitizeNotificationText(
        `AutoCyber completed a pull request scan for ${repository.owner}/${repository.name} on ${scanJob.branch}.`,
      ),
    });
  } else if (scanJob.source === "push") {
    await store.createNotification({
      repositoryId: repository.id,
      scanJobId: scanJob.id,
      findingId: null,
      type: "webhook_scan_completed",
      severity: "info",
      title: "Webhook scan completed",
      message: sanitizeNotificationText(
        `AutoCyber completed a push-triggered scan for ${repository.owner}/${repository.name} on ${scanJob.branch}.`,
      ),
    });
  }

  const actionableFindings = findings.filter(
    (finding) =>
      finding.memoryStatus !== "false_positive_suppressed" &&
      (finding.lifecycleStatus === "new" ||
        finding.lifecycleStatus === "reappeared") &&
      (finding.severity === "medium" ||
        finding.severity === "high" ||
        finding.severity === "critical"),
  );
  if (actionableFindings.length > 0) {
    await store.createNotification({
      repositoryId: repository.id,
      scanJobId: scanJob.id,
      findingId: null,
      type: "new_findings_detected",
      severity: highestSeverity(actionableFindings),
      title: "New actionable findings detected",
      message: `${actionableFindings.length} medium or higher severity finding${actionableFindings.length === 1 ? "" : "s"} were detected in the latest monitoring scan.`,
    });
  }

  for (const finding of findings) {
    if (finding.memoryStatus === "false_positive_suppressed") continue;
    if (
      finding.lifecycleStatus !== "new" &&
      finding.lifecycleStatus !== "reappeared"
    )
      continue;
    if (finding.severity === "high") {
      await createFindingNotification(
        store,
        repository,
        scanJob,
        finding,
        "high_severity_finding_detected",
      );
    }
    if (finding.severity === "critical") {
      await createFindingNotification(
        store,
        repository,
        scanJob,
        finding,
        "critical_finding_detected",
      );
    }
  }
}

async function createFindingNotification(
  store: PersistenceStore,
  repository: Repository,
  scanJob: ScanJob,
  finding: ScannerResult["findings"][number],
  type: NotificationType,
): Promise<void> {
  const decisionMemory = await store.getFixDecisionMemoryContext({
    repositoryId: repository.id,
    findingFingerprint: finding.fingerprint ?? null,
    ruleId: finding.ruleId ?? null,
  });
  const priority = scoreFindingPriority(finding, { decisionMemory });
  const memoryContext = decisionMemory.previouslyAccepted
    ? " Previously accepted fix pattern available."
    : decisionMemory.previouslyRejected
      ? " Similar fix was previously rejected."
      : "";
  const priorityContext = ` Priority: ${formatPriorityBand(priority.priorityBand)}. Top reason: ${priority.priorityReasons[0] ?? "Requires security review"}.`;

  await store.createNotification({
    repositoryId: repository.id,
    scanJobId: scanJob.id,
    findingId: finding.id,
    type,
    severity: finding.severity,
    title:
      finding.severity === "critical"
        ? "Critical finding detected"
        : "High severity finding detected",
    message: sanitizeNotificationText(
      `${finding.title} in ${repository.owner}/${repository.name} at ${finding.affectedFile}.${priorityContext}${memoryContext}`,
    ),
  });
}

function highestSeverity(findings: ScannerResult["findings"]): Severity {
  if (findings.some((finding) => finding.severity === "critical"))
    return "critical";
  if (findings.some((finding) => finding.severity === "high")) return "high";
  if (findings.some((finding) => finding.severity === "medium"))
    return "medium";
  return "info";
}

function sanitizeNotificationText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DB_URL]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_[REDACTED]")
    .replace(/\bgh[opsu]_[A-Za-z0-9_]+\b/g, "gh_[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[REDACTED]")
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    );
}

function normalizeQueueProcessLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return defaultQueueProcessLimit;
  return Math.max(1, Math.min(maxQueueProcessLimit, Math.floor(value)));
}

export async function retryScanJob(
  store: PersistenceStore,
  scanJobId: string,
): Promise<ScanJob> {
  const scanJob = await store.getScanJob(scanJobId);
  if (!scanJob) {
    throw new Error("Scan job was not found.");
  }

  if (scanJob.status !== "failed") {
    throw new Error("Only failed scan jobs can be retried.");
  }

  const retry = await enqueueScanJob(store, {
    repositoryId: scanJob.repositoryId,
    source: scanJob.source,
    branch: scanJob.branch,
    commitSha: scanJob.commitSha,
    webhookDeliveryId: null,
    pullRequestNumber: scanJob.pullRequestNumber,
  });
  await store.writeAuditLog("scan_retry_queued", "scan_job", retry.id);
  return retry;
}

async function runScannerForRepository(
  scanJob: ScanJob,
  repository: Repository,
  options: ProcessScanJobOptions,
): Promise<ScannerResult> {
  const scanRepositoryPath =
    options.scanRepositoryPath ?? defaultScanRepositoryPath;

  if (repository.provider === "local") {
    return scanRepositoryPath(repository.url, repository.id, scanJob.id);
  }

  if (repository.isPrivate) {
    if (!repository.installationId) {
      throw new GitHubIngestionError(
        "private_repo_requires_installation",
        "Private repository scanning requires GitHub App installation.",
      );
    }

    const fetchPrivateGitHubRepository =
      options.fetchPrivateGitHubRepository ??
      defaultFetchPrivateGitHubRepository;
    return fetchPrivateGitHubRepository({
      repository,
      scan: (repositoryPath) =>
        scanRepositoryPath(repositoryPath, repository.id, scanJob.id),
    });
  }

  const fetchPublicGitHubRepository =
    options.fetchPublicGitHubRepository ?? defaultFetchPublicGitHubRepository;
  return fetchPublicGitHubRepository({
    repository,
    scan: (repositoryPath) =>
      scanRepositoryPath(repositoryPath, repository.id, scanJob.id),
  });
}

async function defaultFetchPublicGitHubRepository(input: {
  repository: Repository;
  scan(repositoryPath: string): Promise<ScannerResult>;
}): Promise<ScannerResult> {
  return clonePublicGitHubRepository({
    repoUrl: input.repository.url,
    scan: input.scan,
  });
}

async function defaultFetchPrivateGitHubRepository(input: {
  repository: Repository;
  scan(repositoryPath: string): Promise<ScannerResult>;
}): Promise<ScannerResult> {
  return cloneGitHubRepositoryWithInstallationToken({
    repoUrl: input.repository.url,
    installationId: input.repository.installationId!,
    scan: input.scan,
  });
}

async function defaultScanRepositoryPath(
  repositoryPath: string,
  repositoryId: string,
  scanJobId: string,
): Promise<ScannerResult> {
  return createLocalScanner().scan({
    repositoryPath,
    repositoryId,
    scanJobId,
  });
}

function summarizeFindings(
  findings: ScannerResult["findings"],
): FindingSummary {
  const activeFindings = findings.filter(
    (finding) => finding.lifecycleStatus !== "resolved",
  );
  const summary = activeFindings.reduce(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  );
  return {
    ...summary,
    lifecycle: summarizeFindingLifecycle(
      findings.filter((finding) => finding.lifecycleStatus),
    ),
  };
}
