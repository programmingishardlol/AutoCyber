import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstallationAccessToken } from "./github-app-auth";
import { GitHubIngestionError, parsePublicGitHubUrl, type GitRunner } from "./github-ingestion";

export interface CloneGitHubRepositoryWithInstallationTokenInput<T> {
  repoUrl: string;
  installationId: string;
  workdir?: string;
  runGit?: GitRunner;
  createInstallationToken?: (installationId: string) => Promise<string>;
  scan(repositoryPath: string): Promise<T>;
}

export async function cloneGitHubRepositoryWithInstallationToken<T>(
  input: CloneGitHubRepositoryWithInstallationTokenInput<T>
): Promise<T> {
  const locator = parsePublicGitHubUrl(input.repoUrl);
  if (!locator) {
    throw new GitHubIngestionError("invalid_github_url", "Enter a GitHub repository URL like https://github.com/owner/repo.");
  }

  const tokenFactory = input.createInstallationToken ?? createInstallationAccessToken;
  const token = await tokenFactory(input.installationId);
  const workdir = input.workdir ?? process.env.SCANNER_WORKDIR ?? join(tmpdir(), "autocyber-scans");
  await mkdir(workdir, { recursive: true });
  const sessionDir = await mkdtemp(join(workdir, "github-app-"));
  const destination = join(sessionDir, `${locator.owner}-${locator.repo}`);

  try {
    const runGit = input.runGit ?? defaultRunGit;
    await runGit("git", ["clone", "--depth", "1", "--single-branch", locator.repoUrl, destination], {
      env: gitAuthEnv(token)
    });
    return await input.scan(destination);
  } catch (error) {
    if (error instanceof GitHubIngestionError) throw error;
    throw new GitHubIngestionError(
      "private_repo_clone_failed",
      "AutoCyber could not fetch the private GitHub repository with the installed GitHub App."
    );
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
}

function gitAuthEnv(token: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`
  };
}

async function defaultRunGit(command: string, args: string[], options?: Parameters<GitRunner>[2]): Promise<void> {
  const { promisify } = await import("node:util");
  const { execFile } = await import("node:child_process");
  await promisify(execFile)(command, args, {
    env: options?.env ? { ...process.env, ...options.env } : process.env,
    timeout: Number(process.env.SCANNER_TIMEOUT_SECONDS ?? "120") * 1000,
    maxBuffer: 1024 * 1024
  });
}
