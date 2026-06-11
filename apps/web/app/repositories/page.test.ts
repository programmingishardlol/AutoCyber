import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/repositories/page.tsx"), "utf8");
const syncButtonSource = readFileSync(join(process.cwd(), "components/github-app-sync-button.tsx"), "utf8");

describe("repositories GitHub App connection entrypoint", () => {
  it("opens Connect GitHub App in a new tab with the configured install URL", () => {
    expect(source).toContain("href={githubAppInstallUrl}");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noreferrer noopener"');
    expect(source).toContain("Connect GitHub App");
  });

  it("shows a safe disabled state when the install URL is missing", () => {
    expect(source).toContain("GitHub App install URL not configured");
  });

  it("explains the callback URL required for connected repositories to appear", () => {
    expect(source).toContain("GitHub opens in a new tab");
    expect(source).toContain("GitHub App Setup URL / Callback URL");
    expect(source).toContain("/api/github-app/callback");
  });

  it("renders sync and sort controls for repository capabilities", () => {
    expect(source).toContain("GitHubAppSyncButton");
    expect(source).not.toContain('action="/api/github-app/sync"');
    expect(syncButtonSource).toContain("Sync GitHub App repositories");
    expect(source).toContain("Last scanned");
    expect(source).toContain("Added");
    expect(source).toContain("sort=created_at");
  });

  it("syncs GitHub App repositories in-page with JSON instead of an HTML redirect form", () => {
    expect(syncButtonSource).toContain('"use client"');
    expect(syncButtonSource).toContain('fetch("/api/github-app/sync"');
    expect(syncButtonSource).toContain('"content-type": "application/json"');
    expect(syncButtonSource).toContain("router.refresh()");
    expect(syncButtonSource).toContain("Syncing");
  });

  it("shows repository-level GitHub App access state instead of installation-level connected status", () => {
    expect(source).toContain("repository access removed");
    expect(source).toContain("repository access connected");
    expect(source).not.toContain("status: {installation.status}");
  });

  it("links GitHub repository names to their GitHub URL in a new tab", () => {
    expect(source).toContain("getRepositoryGitHubUrl(repository)");
    expect(source).toContain("repositoryGitHubUrl ? (");
    expect(source).toContain("href={repositoryGitHubUrl}");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noreferrer noopener"');
  });

  it("keeps local or non-GitHub repositories as plain repository name text", () => {
    expect(source).toContain("repositoryGitHubUrl ? (");
    expect(source).toContain("{repository.owner}/{repository.name}");
  });
});
