import { describe, expect, it } from "vitest";
import type { Repository } from "@autocyber/core";
import { sortRepositoriesByLastScanned } from "./repository-list";

describe("repository list sorting", () => {
  it("sorts repositories by last scanned time with unscanned repositories last", () => {
    const repositories = [
      repository({ id: "repo_old", lastScannedAt: "2026-06-01T10:00:00.000Z", updatedAt: "2026-06-06T10:00:00.000Z" }),
      repository({ id: "repo_unscanned", lastScannedAt: null, updatedAt: "2026-06-06T12:00:00.000Z" }),
      repository({ id: "repo_new", lastScannedAt: "2026-06-06T11:00:00.000Z", updatedAt: "2026-06-06T11:00:00.000Z" })
    ];

    expect(sortRepositoriesByLastScanned(repositories).map((item) => item.id)).toEqual([
      "repo_new",
      "repo_old",
      "repo_unscanned"
    ]);
  });
});

function repository(input: Pick<Repository, "id" | "lastScannedAt" | "updatedAt">): Repository {
  return {
    id: input.id,
    projectId: "proj_dev",
    provider: "github",
    owner: "example",
    name: input.id,
    defaultBranch: "main",
    url: `https://github.com/example/${input.id}`,
    installationId: null,
    isPrivate: false,
    connectionType: "public_github",
    canScan: true,
    canMonitor: false,
    canOpenPr: false,
    permissionsSummary: {},
    lastScannedAt: input.lastScannedAt,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: input.updatedAt
  };
}
