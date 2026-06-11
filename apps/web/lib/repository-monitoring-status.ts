import type { Repository } from "@autocyber/core";

export interface RepositoryMonitoringStatus {
  label: string;
  tone: "success" | "warning" | "muted";
  detail: string;
}

export interface RepositoryCapabilityBadge {
  label: string;
  tone: "success" | "warning" | "muted";
}

export function getRepositoryMonitoringStatus(repository: Repository): RepositoryMonitoringStatus {
  if (repository.provider !== "github") {
    return {
      label: "Local development only",
      tone: "muted",
      detail: "Webhook monitoring is only available for connected GitHub repositories."
    };
  }

  if (repository.isPrivate && !repository.installationId) {
    return {
      label: "GitHub App required",
      tone: "warning",
      detail: "Private monitoring requires a connected GitHub App installation ID."
    };
  }

  if (hasRemovedGitHubAppAccess(repository)) {
    return {
      label: "GitHub App access removed",
      tone: "warning",
      detail: "This repository history is preserved, but monitoring is disabled because it is no longer selected in the GitHub App installation."
    };
  }

  if (repository.installationId) {
    if (repository.isPrivate) {
      return {
        label: "Private monitoring enabled",
        tone: "success",
        detail: "GitHub App installation ID is present for private repository fetches. GitHub App PR remediation is not implemented yet."
      };
    }

    return {
      label: "Public monitoring enabled",
      tone: "success",
      detail: "GitHub App monitoring is connected for this public repository. GitHub App PR remediation is not implemented yet."
    };
  }

  if (repository.connectionType === "public_github" && !repository.canMonitor) {
    return {
      label: "One-time public scan",
      tone: "warning",
      detail: "Public GitHub URL scans work without a token, but continuous monitoring and PR remediation require a GitHub App connection."
    };
  }

  return {
    label: repository.canMonitor ? "Public monitoring enabled" : "Public scan enabled",
    tone: "success",
    detail: repository.canMonitor
      ? "GitHub App monitoring is connected for this public repository. GitHub App PR remediation is not implemented yet."
      : "Public GitHub URL scans work without a token. Monitoring requires a GitHub connection."
  };
}

export function getRepositoryCapabilityBadges(repository: Repository): RepositoryCapabilityBadge[] {
  const appInstalled = Boolean(repository.installationId);
  const accessRemoved = hasRemovedGitHubAppAccess(repository);
  const canScan = repository.canScan || (appInstalled && !accessRemoved);
  const canMonitor = repository.canMonitor || (appInstalled && !accessRemoved);
  const canOpenPr = repository.canOpenPr && !appInstalled ? repository.canOpenPr : false;
  const privateRepoSupport = repository.isPrivate && appInstalled;

  return [
    {
      label: canScan ? "Scan enabled" : "Scan disabled",
      tone: canScan ? "success" : "warning"
    },
    {
      label: canMonitor ? "Monitoring enabled" : "Monitoring disabled",
      tone: canMonitor ? "success" : "warning"
    },
    {
      label: canOpenPr ? "PR remediation enabled" : "PR remediation disabled",
      tone: canOpenPr ? "success" : "warning"
    },
    accessRemoved
      ? {
          label: "GitHub App access removed",
          tone: "warning"
        }
      : {
          label: appInstalled ? "GitHub App installed" : "GitHub App missing",
          tone: appInstalled ? "success" : "muted"
        },
    {
      label: privateRepoSupport ? "Private repo support enabled" : "Private repo support disabled",
      tone: privateRepoSupport ? "success" : "muted"
    }
  ];
}

export function hasRemovedGitHubAppAccess(repository: Repository): boolean {
  return repository.permissionsSummary.connectionStatus === "disconnected" || repository.permissionsSummary.accessRemovedFromInstallation === true;
}
