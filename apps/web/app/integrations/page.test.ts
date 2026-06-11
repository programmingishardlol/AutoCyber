import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "app/integrations/page.tsx"), "utf8");

describe("integrations GitHub App sync controls", () => {
  it("uses the in-page GitHub App sync button instead of an HTML redirect form", () => {
    expect(source).toContain("GitHubAppSyncButton");
    expect(source).not.toContain('action="/api/github-app/sync"');
  });

  it("keeps the GitHub App install link safe", () => {
    expect(source).toContain("href={githubAppInstallUrl}");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noreferrer noopener"');
  });
});
