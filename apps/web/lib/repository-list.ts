import type { Repository } from "@autocyber/core";
import { dedupeRepositories } from "./repository-identity";

export type RepositorySortKey = "last_scanned" | "created_at";

export function sortRepositories(repositories: Repository[], sort: RepositorySortKey = "last_scanned"): Repository[] {
  const uniqueRepositories = dedupeRepositories(repositories);
  return sort === "created_at" ? sortRepositoriesByCreatedAt(uniqueRepositories) : sortRepositoriesByLastScanned(uniqueRepositories);
}

export function sortRepositoriesByLastScanned(repositories: Repository[]): Repository[] {
  return dedupeRepositories(repositories).sort((left, right) => {
    const lastScannedDelta = timestamp(right.lastScannedAt) - timestamp(left.lastScannedAt);
    if (lastScannedDelta !== 0) return lastScannedDelta;
    return timestamp(right.updatedAt) - timestamp(left.updatedAt);
  });
}

export function sortRepositoriesByCreatedAt(repositories: Repository[]): Repository[] {
  return dedupeRepositories(repositories).sort((left, right) => {
    const createdDelta = timestamp(right.createdAt) - timestamp(left.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return timestamp(right.updatedAt) - timestamp(left.updatedAt);
  });
}

function timestamp(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}
