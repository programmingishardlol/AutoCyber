import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/repositories/new/page.tsx"), "utf8");

describe("new repository GitHub App onboarding page", () => {
  it("opens the configured GitHub App install URL in a new tab", () => {
    expect(source).toContain("href={githubAppInstallUrl}");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noreferrer noopener"');
    expect(source).toContain("GitHub opens in a new tab");
  });

  it("keeps a safe disabled state when the install URL is not configured", () => {
    expect(source).toContain("GitHub App install URL not configured");
  });

  it("shows an installation status panel after GitHub redirects back to AutoCyber", () => {
    expect(source).toContain("resolvedSearchParams?.githubApp === \"connected\"");
    expect(source).toContain("GitHub App connected");
    expect(source).toContain("selected during installation can now be scanned and monitored");
  });

  it("explains the GitHub App callback URL requirement", () => {
    expect(source).toContain("GitHub App Setup URL / Callback URL");
    expect(source).toContain("/api/github-app/callback");
  });
});
