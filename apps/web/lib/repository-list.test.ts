import { describe, expect, it } from "vitest";
import type { Repository } from "@autocyber/core";
import { sortRepositories, sortRepositoriesByCreatedAt, sortRepositoriesByLastScanned } from "./repository-list";

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

  it("sorts repositories by added time when requested", () => {
    const repositories = [
      repository({ id: "repo_old", lastScannedAt: "2026-06-07T10:00:00.000Z", updatedAt: "2026-06-07T10:00:00.000Z", createdAt: "2026-06-01T09:00:00.000Z" }),
      repository({ id: "repo_new", lastScannedAt: "2026-06-01T10:00:00.000Z", updatedAt: "2026-06-01T10:00:00.000Z", createdAt: "2026-06-07T09:00:00.000Z" })
    ];

    expect(sortRepositoriesByCreatedAt(repositories).map((item) => item.id)).toEqual(["repo_new", "repo_old"]);
    expect(sortRepositories(repositories, "created_at").map((item) => item.id)).toEqual(["repo_new", "repo_old"]);
  });

  it("deduplicates GitHub repositories and prefers GitHub App connections over public URL rows", () => {
    const publicRow = repository({
      id: "repo_public",
      lastScannedAt: "2026-06-07T10:00:00.000Z",
      updatedAt: "2026-06-07T10:00:00.000Z",
      createdAt: "2026-06-07T10:00:00.000Z"
    });
    const githubAppRow: Repository = {
      ...publicRow,
      id: "repo_app",
      owner: "Example",
      name: "REPO_PUBLIC",
      installationId: "12345",
      connectionType: "github_app",
      canMonitor: true,
      isPrivate: true,
      updatedAt: "2026-06-06T10:00:00.000Z"
    };

    expect(sortRepositories([publicRow, githubAppRow]).map((item) => item.id)).toEqual(["repo_app"]);
  });
});

function repository(input: Pick<Repository, "id" | "lastScannedAt" | "updatedAt"> & Partial<Pick<Repository, "createdAt">>): Repository {
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
    createdAt: input.createdAt ?? "2026-06-01T09:00:00.000Z",
    updatedAt: input.updatedAt
  };
}
