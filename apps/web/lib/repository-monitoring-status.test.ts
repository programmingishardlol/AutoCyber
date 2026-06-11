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
      label: "One-time public scan",
      tone: "warning",
      detail: "Public GitHub URL scans work without a token, but continuous monitoring and PR remediation require a GitHub App connection."
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
      detail: "GitHub App installation ID is present for private repository fetches. GitHub App PR remediation is not implemented yet."
    });
  });

  it("treats an installation id as a GitHub App connection even when old public scan fields are stale", () => {
    expect(
      getRepositoryMonitoringStatus({
        ...baseRepository,
        installationId: "12345",
        connectionType: "public_github",
        canMonitor: false
      })
    ).toEqual({
      label: "Public monitoring enabled",
      tone: "success",
      detail: "GitHub App monitoring is connected for this public repository. GitHub App PR remediation is not implemented yet."
    });

    expect(
      getRepositoryCapabilityBadges({
        ...baseRepository,
        installationId: "12345",
        connectionType: "public_github",
        canMonitor: false
      }).map((badge) => badge.label)
    ).toEqual([
      "Scan enabled",
      "Monitoring enabled",
      "PR remediation disabled",
      "GitHub App installed",
      "Private repo support disabled"
    ]);
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
      "PR remediation disabled",
      "GitHub App installed",
      "Private repo support enabled"
    ]);
    expect(badges.map((badge) => badge.tone)).toEqual(["success", "success", "warning", "success", "success"]);
  });

  it("shows access-removed repositories as disconnected everywhere", () => {
    const repository: Repository = {
      ...baseRepository,
      installationId: "12345",
      connectionType: "github_app",
      canScan: false,
      canMonitor: false,
      permissionsSummary: {
        contents: "read",
        pullRequests: "read",
        connectionStatus: "disconnected",
        accessRemovedFromInstallation: true
      }
    };

    expect(getRepositoryMonitoringStatus(repository)).toEqual({
      label: "GitHub App access removed",
      tone: "warning",
      detail: "This repository history is preserved, but monitoring is disabled because it is no longer selected in the GitHub App installation."
    });

    expect(getRepositoryCapabilityBadges(repository).map((badge) => badge.label)).toEqual([
      "Scan disabled",
      "Monitoring disabled",
      "PR remediation disabled",
      "GitHub App access removed",
      "Private repo support disabled"
    ]);
  });
});
