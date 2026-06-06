import type { Repository } from "@autocyber/core";

export function sortRepositoriesByLastScanned(repositories: Repository[]): Repository[] {
  return [...repositories].sort((left, right) => {
    const lastScannedDelta = timestamp(right.lastScannedAt) - timestamp(left.lastScannedAt);
    if (lastScannedDelta !== 0) return lastScannedDelta;
    return timestamp(right.updatedAt) - timestamp(left.updatedAt);
  });
}

function timestamp(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}
