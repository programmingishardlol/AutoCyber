import type { Repository } from "@autocyber/core";

type RepositoryIdentityInput = Pick<Repository, "provider" | "owner" | "name" | "url">;

export function getRepositoryIdentity(repository: RepositoryIdentityInput): string {
  if (repository.provider === "github") {
    return `github:${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
  }

  return `local:${repository.url}`;
}

export function sameRepositoryIdentity(left: RepositoryIdentityInput, right: RepositoryIdentityInput): boolean {
  return getRepositoryIdentity(left) === getRepositoryIdentity(right);
}

export function dedupeRepositories(repositories: Repository[]): Repository[] {
  const records = new Map<string, Repository>();
  for (const repository of repositories) {
    const identity = getRepositoryIdentity(repository);
    const existing = records.get(identity);
    if (!existing || compareRepositoryCanonicalRank(repository, existing) < 0) {
      records.set(identity, repository);
    }
  }
  return Array.from(records.values());
}

function compareRepositoryCanonicalRank(left: Repository, right: Repository): number {
  const connectionDelta = repositoryConnectionRank(left) - repositoryConnectionRank(right);
  if (connectionDelta !== 0) return connectionDelta;

  const lastScannedDelta = timestamp(right.lastScannedAt) - timestamp(left.lastScannedAt);
  if (lastScannedDelta !== 0) return lastScannedDelta;

  const updatedDelta = timestamp(right.updatedAt) - timestamp(left.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;

  return timestamp(right.createdAt) - timestamp(left.createdAt);
}

function repositoryConnectionRank(repository: Repository): number {
  if (repository.connectionType === "github_app" && repository.installationId && repository.permissionsSummary.connectionStatus !== "disconnected") return 0;
  if (repository.connectionType === "github_app" && repository.installationId) return 1;
  if (repository.connectionType === "token_dev") return 2;
  if (repository.connectionType === "public_github") return 3;
  return 4;
}

function timestamp(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}
