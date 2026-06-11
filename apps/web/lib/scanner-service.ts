import { createLocalScanner, type ScannerResult } from "@autocyber/scanner";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Repository } from "@autocyber/core";
import { GitHubAppAuthError } from "./github-app-auth";
import { clonePublicGitHubRepository, GitHubIngestionError, parsePublicGitHubUrl } from "./github-ingestion";
import { cloneGitHubRepositoryWithInstallationToken } from "./github-private-ingestion";
import { getPersistenceStore } from "./persistence/store";
import { normalizeScannerResultForContext } from "./scan-result-context";

export type ScanSource = "local" | "github";

export interface ScanRequestInput {
  source: ScanSource;
  path?: string;
  repoUrl?: string;
  repositoryId?: string;
}

export interface ScanJobResponse {
  id: string;
  status: "queued" | "completed" | "failed";
  source: ScanSource;
}

export interface ScanResponse {
  scanJob: ScanJobResponse;
  repository: Repository;
  message?: string;
  result?: ScannerResult;
  findings: ScannerResult["findings"];
  projectProfile: ScannerResult["projectProfile"] | null;
  errors: Array<{ path: string; message: string }>;
}

export interface ScanErrorResponse {
  error: "invalid repo input" | "unsupported source" | "path not allowed" | "scan failed";
  message: string;
}

export interface RunScanOptions {
  clonePublicRepository?: typeof clonePublicGitHubRepository;
  cloneInstalledRepository?: typeof cloneGitHubRepositoryWithInstallationToken;
}

const allowedLocalRoots = [resolve(process.cwd()), resolve(process.cwd(), "../.."), resolve(process.cwd(), "../../.."), "/tmp", "/private/tmp"];

export async function runScan(input: ScanRequestInput, options: RunScanOptions = {}): Promise<{ status: number; body: ScanResponse | ScanErrorResponse }> {
  if (input.source === "github") {
    return runGitHubScan(input, options);
  }

  if (input.source !== "local") {
    return {
      status: 400,
      body: {
        error: "unsupported source",
        message: "Use source `local` for development scans or `github` for the placeholder flow."
      }
    };
  }

  if (!input.path || typeof input.path !== "string") {
    return {
      status: 400,
      body: {
        error: "invalid repo input",
        message: "A local repository path is required for local scans."
      }
    };
  }

  const repositoryPath = resolve(input.path);
  if (!isAllowedLocalPath(repositoryPath) || !existsSync(repositoryPath)) {
    return {
      status: 400,
      body: {
        error: "path not allowed",
        message: "Local development scans are limited to the workspace, sibling development repositories, or temporary directories."
      }
    };
  }

  try {
    const store = getPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "local",
      owner: "local",
      name: basename(repositoryPath),
      defaultBranch: "local",
      url: repositoryPath,
      connectionType: "local",
      canScan: true,
      canMonitor: false,
      canOpenPr: false,
      permissionsSummary: {
        mode: "local_development"
      }
    });
    const scanJobRecord = await store.createScanJob({
      repositoryId: repository.id,
      source: "manual",
      branch: "local",
      commitSha: "unknown"
    });
    const scanJobId = scanJobRecord.id;
    const rawResult = await createLocalScanner().scan({
      repositoryPath,
      repositoryId: input.repositoryId ?? repository.id,
      scanJobId
    });
    const result = normalizeScannerResultForContext(rawResult, {
      repositoryId: repository.id,
      scanJobId
    });
    await persistCompletedScan(result);

    return {
      status: 200,
      body: {
        scanJob: {
          id: scanJobId,
          status: "completed",
          source: "local"
        },
        repository,
        result,
        findings: result.findings,
        projectProfile: result.projectProfile,
        errors: result.errors
      }
    };
  } catch {
    return {
      status: 500,
      body: {
        error: "scan failed",
        message: "The scanner failed before it could return normalized findings."
      }
    };
  }
}

async function runGitHubScan(input: ScanRequestInput, options: RunScanOptions): Promise<{ status: number; body: ScanResponse | ScanErrorResponse }> {
  if (!input.repoUrl || typeof input.repoUrl !== "string") {
    return {
      status: 400,
      body: {
        error: "invalid repo input",
        message: "A public GitHub repository URL is required for GitHub scans."
      }
    };
  }

  const locator = parsePublicGitHubUrl(input.repoUrl);
  if (!locator) {
    return {
      status: 400,
      body: {
        error: "invalid repo input",
        message: "Enter a public GitHub repository URL like https://github.com/owner/repo."
      }
    };
  }

  const store = getPersistenceStore();
  const existingRepository = await store.findGitHubRepository(locator.owner, locator.repo);
  if (existingRepository?.installationId || existingRepository?.connectionType === "github_app" || existingRepository?.isPrivate) {
    return runInstalledGitHubScan(input.repoUrl, existingRepository, options);
  }

  const repository = await store.upsertRepository({
    projectId: "proj_dev",
    provider: "github",
    owner: locator.owner,
    name: locator.repo,
    defaultBranch: "main",
    url: `https://github.com/${locator.owner}/${locator.repo}`,
    connectionType: "public_github",
    canScan: true,
    canMonitor: false,
    canOpenPr: false,
    isPrivate: false,
    permissionsSummary: {
      contents: "public_read",
      pullRequests: "none",
      note: "Public URL scans do not grant write access for remediation PRs."
    }
  });
  const scanJobRecord = await store.createScanJob({
    repositoryId: repository.id,
    source: "manual",
    branch: "main",
    commitSha: "unknown"
  });

  try {
    const rawResult = await (options.clonePublicRepository ?? clonePublicGitHubRepository)({
      repoUrl: input.repoUrl,
      scan: (repositoryPath) => scanRepositoryPath(repositoryPath, repository.id, scanJobRecord.id)
    });
    const result = normalizeScannerResultForContext(rawResult, {
      repositoryId: repository.id,
      scanJobId: scanJobRecord.id
    });

    await persistCompletedScan(result);
    return {
      status: 200,
      body: {
        scanJob: {
          id: scanJobRecord.id,
          status: "completed",
          source: "github"
        },
        repository,
        result,
        findings: result.findings,
        projectProfile: result.projectProfile,
        errors: result.errors
      }
    };
  } catch (error) {
    await store.failScanJob(scanJobRecord.id);
    if (error instanceof GitHubIngestionError) {
      return {
        status: 400,
        body: {
          error: "invalid repo input",
          message: error.message
        }
      };
    }

    return {
      status: 500,
      body: {
        error: "scan failed",
        message: "The public GitHub repository scan failed before it could return normalized findings."
      }
    };
  }
}

async function runInstalledGitHubScan(
  repoUrl: string,
  repository: Repository,
  options: RunScanOptions
): Promise<{ status: number; body: ScanResponse | ScanErrorResponse }> {
  const store = getPersistenceStore();

  if (!repository.installationId) {
    return {
      status: 400,
      body: {
        error: "invalid repo input",
        message: "Private repository scanning requires GitHub App installation."
      }
    };
  }
  const installationId = repository.installationId;

  const installedRepository = await store.upsertRepository({
    projectId: repository.projectId,
    provider: "github",
    owner: repository.owner,
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    url: repository.url || repoUrl,
    installationId,
    isPrivate: repository.isPrivate,
    connectionType: "github_app",
    canScan: true,
    canMonitor: true,
    canOpenPr: false,
    permissionsSummary: {
      ...repository.permissionsSummary,
      connectionStatus: "connected",
      githubAppPrCreationImplemented: false
    }
  });

  const scanJobRecord = await store.createScanJob({
    repositoryId: installedRepository.id,
    source: "manual",
    branch: installedRepository.defaultBranch,
    commitSha: "unknown"
  });

  try {
    const cloneInstalledRepository = options.cloneInstalledRepository ?? cloneGitHubRepositoryWithInstallationToken;
    const rawResult: ScannerResult = await cloneInstalledRepository<ScannerResult>({
      repoUrl: installedRepository.url || repoUrl,
      installationId,
      scan: (repositoryPath) => scanRepositoryPath(repositoryPath, installedRepository.id, scanJobRecord.id)
    });
    const result = normalizeScannerResultForContext(rawResult, {
      repositoryId: installedRepository.id,
      scanJobId: scanJobRecord.id
    });

    await persistCompletedScan(result);
    return {
      status: 200,
      body: {
        scanJob: {
          id: scanJobRecord.id,
          status: "completed",
          source: "github"
        },
        repository: installedRepository,
        result,
        findings: result.findings,
        projectProfile: result.projectProfile,
        errors: result.errors
      }
    };
  } catch (error) {
    const message =
      error instanceof GitHubIngestionError || error instanceof GitHubAppAuthError
        ? error.message
        : "The installed GitHub repository scan failed before it could return normalized findings.";
    await store.failScanJob(scanJobRecord.id, message);
    return {
      status: error instanceof GitHubIngestionError || error instanceof GitHubAppAuthError ? 400 : 500,
      body: {
        error: error instanceof GitHubIngestionError || error instanceof GitHubAppAuthError ? "invalid repo input" : "scan failed",
        message
      }
    };
  }
}

async function scanRepositoryPath(repositoryPath: string, repositoryId: string, scanJobId: string): Promise<ScannerResult> {
  return createLocalScanner().scan({
    repositoryPath,
    repositoryId,
    scanJobId
  });
}

async function persistCompletedScan(result: ScannerResult): Promise<void> {
  const store = getPersistenceStore();
  await store.saveFindings(result.findings);
  await store.upsertRepoProfileMemory(result.repositoryId, result.projectProfile);
  await store.completeScanJob(result.scanJobId, summarizeFindings(result.findings));
}

function summarizeFindings(findings: ScannerResult["findings"]) {
  return findings.reduce(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  );
}

function isAllowedLocalPath(path: string): boolean {
  return allowedLocalRoots.some((root) => path === root || path.startsWith(`${root}/`));
}
