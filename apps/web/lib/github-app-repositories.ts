import type { Repository } from "@autocyber/core";
import { createInstallationAccessToken, GitHubAppAuthError } from "./github-app-auth";

export class GitHubAppRepositoryError extends Error {
  constructor(
    public readonly code: "github_app_repo_list_failed",
    message: string
  ) {
    super(message);
  }
}

export interface GitHubAppRepositoryRecord {
  owner: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  canScan: boolean;
  canMonitor: boolean;
  canOpenPr: boolean;
  permissionsSummary: Repository["permissionsSummary"];
}

interface GitHubInstallationRepositoryResponse {
  repositories?: Array<{
    name?: unknown;
    full_name?: unknown;
    html_url?: unknown;
    private?: unknown;
    default_branch?: unknown;
    owner?: { login?: unknown };
    permissions?: Record<string, unknown>;
  }>;
}

export async function listGitHubAppInstallationRepositories(
  installationId: string,
  options: { fetch?: typeof fetch; createInstallationToken?: (installationId: string) => Promise<string> } = {}
): Promise<GitHubAppRepositoryRecord[]> {
  const requestFetch = options.fetch ?? fetch;
  const tokenFactory = options.createInstallationToken ?? ((id: string) => createInstallationAccessToken(id, { fetch: requestFetch }));
  let token: string;

  try {
    token = await tokenFactory(installationId);
  } catch (error) {
    if (error instanceof GitHubAppAuthError) throw error;
    throw new GitHubAppRepositoryError("github_app_repo_list_failed", "AutoCyber could not load selected GitHub App repositories.");
  }

  const response = await requestFetch("https://api.github.com/installation/repositories", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28"
    }
  });

  if (!response.ok) {
    throw new GitHubAppRepositoryError("github_app_repo_list_failed", "AutoCyber could not load selected GitHub App repositories.");
  }

  const body = (await response.json()) as GitHubInstallationRepositoryResponse;
  return (body.repositories ?? []).map(toRepositoryRecord).filter((repo): repo is GitHubAppRepositoryRecord => repo !== null);
}

function toRepositoryRecord(repo: NonNullable<GitHubInstallationRepositoryResponse["repositories"]>[number]): GitHubAppRepositoryRecord | null {
  const name = typeof repo.name === "string" ? repo.name : null;
  const owner = typeof repo.owner?.login === "string" ? repo.owner.login : extractOwner(repo.full_name);
  const repoUrl = typeof repo.html_url === "string" ? repo.html_url : owner && name ? `https://github.com/${owner}/${name}` : null;
  const defaultBranch = typeof repo.default_branch === "string" && repo.default_branch ? repo.default_branch : "main";
  if (!owner || !name || !repoUrl) return null;

  const permissions = normalizePermissions(repo.permissions ?? {});
  const canScan = permissions.contents === "read" || permissions.contents === "write";
  const canOpenPr = permissions.contents === "write" && permissions.pullRequests === "write";

  return {
    owner,
    name,
    repoUrl,
    defaultBranch,
    isPrivate: repo.private === true,
    canScan,
    canMonitor: canScan,
    canOpenPr,
    permissionsSummary: permissions
  };
}

function extractOwner(fullName: unknown): string | null {
  if (typeof fullName !== "string") return null;
  const [owner] = fullName.split("/");
  return owner || null;
}

function normalizePermissions(permissions: Record<string, unknown>): Repository["permissionsSummary"] {
  return {
    contents: normalizePermission(permissions.contents),
    pullRequests: normalizePermission(permissions.pull_requests ?? permissions.pullRequests),
    metadata: normalizePermission(permissions.metadata)
  };
}

function normalizePermission(value: unknown): string {
  return typeof value === "string" && value ? value : "unknown";
}
