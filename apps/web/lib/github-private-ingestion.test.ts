import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { cloneGitHubRepositoryWithInstallationToken } from "./github-private-ingestion";

describe("private GitHub ingestion", () => {
  it("clones with an installation token through env-based git auth and removes the temp copy", async () => {
    const workdir = join(
      tmpdir(),
      `autocyber-github-private-ingestion-${Date.now()}`,
    );
    let clonedPath = "";
    let observedArgs = "";
    let observedAuthHeader = "";

    const result = await cloneGitHubRepositoryWithInstallationToken({
      repoUrl: "https://github.com/acme/private-app",
      installationId: "12345",
      workdir,
      createInstallationToken: async () =>
        fakeGitHubInstallationToken("private_installation_token"),
      runGit: async (_command, args, options) => {
        clonedPath = String(args.at(-1));
        observedArgs = JSON.stringify(args);
        observedAuthHeader = String(options?.env?.GIT_CONFIG_VALUE_0 ?? "");
        await mkdir(clonedPath, { recursive: true });
        await writeFile(join(clonedPath, "package.json"), "{}");
      },
      scan: async (repositoryPath) => {
        expect(repositoryPath).toBe(clonedPath);
        expect((await stat(repositoryPath)).isDirectory()).toBe(true);
        return { repositoryPath };
      },
    });

    expect(result.repositoryPath).toBe(clonedPath);
    expect(observedArgs).not.toContain(
      fakeGitHubInstallationToken("private_installation_token"),
    );
    expect(observedAuthHeader).toMatch(/^AUTHORIZATION: basic /);
    expect(observedAuthHeader).not.toContain(
      fakeGitHubInstallationToken("private_installation_token"),
    );
    await expect(stat(clonedPath)).rejects.toThrow();
  });

  it("returns a safe error and does not leak the installation token when clone fails", async () => {
    const workdir = join(
      tmpdir(),
      `autocyber-github-private-failure-${Date.now()}`,
    );
    let clonedPath = "";

    await expect(
      cloneGitHubRepositoryWithInstallationToken({
        repoUrl: "https://github.com/acme/private-app",
        installationId: "12345",
        workdir,
        createInstallationToken: async () =>
          fakeGitHubInstallationToken("secret_installation_token"),
        runGit: async (_command, args) => {
          clonedPath = String(args.at(-1));
          await mkdir(clonedPath, { recursive: true });
          throw new Error(
            `fatal: token ${fakeGitHubInstallationToken("secret_installation_token")} failed`,
          );
        },
        scan: async () => ({ ok: true }),
      }),
    ).rejects.toMatchObject({
      code: "private_repo_clone_failed",
      message:
        "AutoCyber could not fetch the private GitHub repository with the installed GitHub App.",
    });
    await expect(stat(clonedPath)).rejects.toThrow();
  });
});

function fakeGitHubInstallationToken(label: string): string {
  return ["ghs", label].join("_");
}
