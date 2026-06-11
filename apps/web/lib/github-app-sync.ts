import type { Repository } from "@autocyber/core";
import { getCurrentAuthContext } from "./auth/session";
import { listGitHubAppInstallationRepositories, type GitHubAppRepositoryRecord } from "./github-app-repositories";
import { getPersistenceStore, type PersistenceStore } from "./persistence/store";

export interface GitHubAppSyncResult {
  installationId: string;
  repositories: Array<Pick<Repository, "owner" | "name" | "isPrivate" | "canScan" | "canMonitor" | "canOpenPr">>;
  repositoriesConnected: number;
  repositoriesDisconnected: number;
}

export interface GitHubAppSyncOptions {
  store?: PersistenceStore;
  listRepositories?: typeof listGitHubAppInstallationRepositories;
}

export async function syncGitHubAppInstallation(installationId: string, options: GitHubAppSyncOptions = {}): Promise<GitHubAppSyncResult> {
  const store = options.store ?? getPersistenceStore();
  const selectedRepositories = await (options.listRepositories ?? listGitHubAppInstallationRepositories)(installationId);
  const auth = await getCurrentAuthContext();
  const selectedKeys = new Set(selectedRepositories.map((repository) => `${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`));
  const permissionsSummary = summarizeInstallationPermissions(selectedRepositories.map((repository) => repository.permissionsSummary));
  const repositories: GitHubAppSyncResult["repositories"] = [];

  await store.upsertGitHubInstallation({
    installationId,
    teamId: auth.teamId,
    userId: auth.userId,
    accountLogin: inferAccountLogin(selectedRepositories),
    accountType: "github_account",
    status: "connected",
    repositorySelection: "selected",
    repositoryCount: selectedRepositories.length,
    permissionsSummary
  });

  for (const repository of selectedRepositories) {
    const record = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      url: repository.repoUrl,
      installationId,
      isPrivate: repository.isPrivate,
      connectionType: "github_app",
      canScan: repository.canScan,
      canMonitor: repository.canMonitor,
      canOpenPr: false,
      permissionsSummary: {
        ...repository.permissionsSummary,
        connectionStatus: "connected",
        accessRemovedFromInstallation: false
      }
    });

    repositories.push({
      owner: record.owner,
      name: record.name,
      isPrivate: record.isPrivate,
      canScan: record.canScan,
      canMonitor: record.canMonitor,
      canOpenPr: record.canOpenPr
    });
  }

  const repositoriesDisconnected = await markRemovedInstallationRepositories(store, installationId, selectedKeys);
  await store.writeAuditLog("github_app_synced", "github_installation", installationId);

  return {
    installationId,
    repositories,
    repositoriesConnected: repositories.length,
    repositoriesDisconnected
  };
}

async function markRemovedInstallationRepositories(
  store: PersistenceStore,
  installationId: string,
  selectedKeys: Set<string>
): Promise<number> {
  const existingRepositories = await store.listRepositories();
  let disconnected = 0;
  for (const repository of existingRepositories) {
    if (repository.installationId !== installationId) continue;
    if (selectedKeys.has(`${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`)) continue;

    await store.upsertRepository({
      projectId: repository.projectId,
      provider: repository.provider,
      owner: repository.owner,
      name: repository.name,
      defaultBranch: repository.defaultBranch,
      url: repository.url,
      installationId,
      isPrivate: repository.isPrivate,
      connectionType: "github_app",
      canScan: false,
      canMonitor: false,
      canOpenPr: false,
      permissionsSummary: {
        ...repository.permissionsSummary,
        connectionStatus: "disconnected",
        accessRemovedFromInstallation: true
      }
    });
    await store.writeAuditLog("github_repository_access_removed", "repository", repository.id);
    disconnected += 1;
  }
  return disconnected;
}

function summarizeInstallationPermissions(summaries: Array<Repository["permissionsSummary"]>): Repository["permissionsSummary"] {
  return {
    contents: summarizePermission(summaries.map((summary) => summary.contents)),
    pullRequests: summarizePermission(summaries.map((summary) => summary.pullRequests)),
    metadata: summarizePermission(summaries.map((summary) => summary.metadata)),
    pullRequestWriteGranted: summaries.some((summary) => summary.pullRequestWriteGranted === true),
    githubAppPrCreationImplemented: false
  };
}

function summarizePermission(values: Array<string | boolean | null | undefined>): string {
  if (values.includes("write")) return "write";
  if (values.includes("read")) return "read";
  if (values.length === 0) return "unknown";
  return "unknown";
}

function inferAccountLogin(repositories: GitHubAppRepositoryRecord[]): string {
  return repositories[0]?.owner ?? "unknown";
}
