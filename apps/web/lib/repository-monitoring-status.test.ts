import { describe, expect, it } from "vitest";
import type { Repository } from "@autocyber/core";
import { getRepositoryCapabilityBadges, getRepositoryMonitoringStatus } from "./repository-monitoring-status";

const baseRepository: Repository = {
  id: "repo_demo",
  projectId: "proj_dev",
  provider: "github",
  owner: "acme",
  name: "app",
  defaultBranch: "main",
  url: "https://github.com/acme/app",
  installationId: null,
  isPrivate: false,
  connectionType: "public_github",
  canScan: true,
  canMonitor: false,
  canOpenPr: false,
  permissionsSummary: {
    contents: "read",
    pullRequests: "none"
  },
  lastScannedAt: null,
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z"
};

describe("repository monitoring status", () => {
  it("marks public GitHub repositories without webhook connection as scan-only", () => {
    expect(getRepositoryMonitoringStatus(baseRepository)).toEqual({
      label: "Public scan enabled",
      tone: "warning",
      detail: "Public GitHub URL scans work without a token. Monitoring and PR remediation need a GitHub connection."
    });
  });

  it("marks private GitHub repositories without installation ids as requiring GitHub App installation", () => {
    expect(getRepositoryMonitoringStatus({ ...baseRepository, isPrivate: true })).toEqual({
      label: "GitHub App required",
      tone: "warning",
      detail: "Private monitoring requires a connected GitHub App installation ID."
    });
  });

  it("marks private GitHub repositories with installation ids as monitorable", () => {
    expect(
      getRepositoryMonitoringStatus({
        ...baseRepository,
        isPrivate: true,
        installationId: "12345",
        connectionType: "github_app",
        canMonitor: true
      })
    ).toEqual({
      label: "Private monitoring enabled",
      tone: "success",
      detail: "GitHub App installation ID is present for private repository fetches."
    });
  });

  it("renders capability badges for scan, monitoring, PR remediation, GitHub App, and private support", () => {
    const badges = getRepositoryCapabilityBadges({
      ...baseRepository,
      connectionType: "github_app",
      installationId: "12345",
      isPrivate: true,
      canScan: true,
      canMonitor: true,
      canOpenPr: true,
      permissionsSummary: {
        contents: "write",
        pullRequests: "write"
      }
    });

    expect(badges.map((badge) => badge.label)).toEqual([
      "Scan enabled",
      "Monitoring enabled",
      "PR remediation enabled",
      "GitHub App installed",
      "Private repo support enabled"
    ]);
    expect(badges.every((badge) => badge.tone === "success")).toBe(true);
  });
});
