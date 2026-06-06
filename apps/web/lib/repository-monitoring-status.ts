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

  if (repository.connectionType === "public_github" && !repository.canMonitor) {
    return {
      label: "Public scan enabled",
      tone: "warning",
      detail: "Public GitHub URL scans work without a token. Monitoring and PR remediation need a GitHub connection."
    };
  }

  if (repository.isPrivate) {
    return {
      label: "Private monitoring enabled",
      tone: "success",
      detail: "GitHub App installation ID is present for private repository fetches."
    };
  }

  return {
    label: repository.canMonitor ? "Public monitoring enabled" : "Public scan enabled",
    tone: "success",
    detail: repository.canMonitor
      ? "Public GitHub monitoring uses the existing public clone scan path."
      : "Public GitHub URL scans work without a token. Monitoring requires a GitHub connection."
  };
}

export function getRepositoryCapabilityBadges(repository: Repository): RepositoryCapabilityBadge[] {
  return [
    {
      label: repository.canScan ? "Scan enabled" : "Scan disabled",
      tone: repository.canScan ? "success" : "warning"
    },
    {
      label: repository.canMonitor ? "Monitoring enabled" : "Monitoring disabled",
      tone: repository.canMonitor ? "success" : "warning"
    },
    {
      label: repository.canOpenPr ? "PR remediation enabled" : "PR remediation disabled",
      tone: repository.canOpenPr ? "success" : "warning"
    },
    {
      label: repository.installationId ? "GitHub App installed" : "GitHub App missing",
      tone: repository.installationId ? "success" : "muted"
    },
    {
      label: repository.isPrivate && repository.installationId ? "Private repo support enabled" : "Private repo support disabled",
      tone: repository.isPrivate && repository.installationId ? "success" : "muted"
    }
  ];
}
