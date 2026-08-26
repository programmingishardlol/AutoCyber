import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createScannerSession, removeScannerSession } from "./scanner-workdir";

const execFileAsync = promisify(execFile);

export interface GitHubRepositoryLocator {
  owner: string;
  repo: string;
  repoUrl: string;
}

export interface GitRunnerOptions {
  env?: Record<string, string>;
}

export type GitRunner = (command: string, args: string[], options?: GitRunnerOptions) => Promise<void>;

export interface ClonePublicGitHubRepositoryInput<T> {
  repoUrl: string;
  workdir?: string;
  runGit?: GitRunner;
  scan(repositoryPath: string): Promise<T>;
}

export class GitHubIngestionError extends Error {
  constructor(
    public readonly code:
      | "invalid_github_url"
      | "unreachable_public_repo"
      | "private_repo_requires_installation"
      | "private_repo_clone_failed",
    message: string
  ) {
    super(message);
  }
}

export function parsePublicGitHubUrl(value: string): GitHubRepositoryLocator | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "github.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;

  const [owner, rawRepo] = segments;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;

  return {
    owner,
    repo,
    repoUrl: `https://github.com/${owner}/${repo}.git`
  };
}

export async function clonePublicGitHubRepository<T>(input: ClonePublicGitHubRepositoryInput<T>): Promise<T> {
  const locator = parsePublicGitHubUrl(input.repoUrl);
  if (!locator) {
    throw new GitHubIngestionError("invalid_github_url", "Enter a public GitHub repository URL like https://github.com/owner/repo.");
  }

  const workdir = input.workdir ?? process.env.SCANNER_WORKDIR ?? join(tmpdir(), "autocyber-scans");
  const sessionDir = await createScannerSession(workdir, "github-");
  const destination = join(sessionDir, `${locator.owner}-${locator.repo}`);

  try {
    const runGit = input.runGit ?? defaultRunGit;
    await runGit("git", ["clone", "--depth", "1", "--single-branch", locator.repoUrl, destination]);
    return await input.scan(destination);
  } catch (error) {
    if (error instanceof GitHubIngestionError) throw error;
    throw new GitHubIngestionError("unreachable_public_repo", safeCloneMessage(String(error)));
  } finally {
    await removeScannerSession(sessionDir);
  }
}

async function defaultRunGit(command: string, args: string[], options: GitRunnerOptions = {}): Promise<void> {
  await execFileAsync(command, args, {
    env: options.env ? { ...process.env, ...options.env } : process.env,
    timeout: Number(process.env.SCANNER_TIMEOUT_SECONDS ?? "120") * 1000,
    maxBuffer: 1024 * 1024
  });
}

function safeCloneMessage(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("repository not found") || lower.includes("authentication") || lower.includes("could not read")) {
    return privateRepoMessage();
  }
  return `${privateRepoMessage()} If the repository is public, try again after confirming the URL is reachable.`;
}

function privateRepoMessage(): string {
  return "AutoCyber could not access that public repository. Private GitHub monitoring requires a connected GitHub App installation.";
}
