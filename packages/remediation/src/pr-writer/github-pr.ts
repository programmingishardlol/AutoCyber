import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Octokit } from "@octokit/rest";
import type { FixProposal } from "@autocyber/core";
import type {
  GitHubPrRemediationResult,
  GitHubRepositoryTarget,
  LocalRemediationExecution,
  RemediationVerificationResult
} from "../types";
import { GITHUB_PR_WORKING_COPY_ERROR, getGitHubPrBlockReason } from "../validation/proposal-safety";

export interface GitHubFileCommit {
  path: string;
  content: string;
}

export interface GitHubRemediationClient {
  getBranchHead(input: { owner: string; repo: string; branch: string }): Promise<{ sha: string }>;
  createBranch(input: { owner: string; repo: string; ref: string; sha: string }): Promise<void>;
  commitFiles(input: {
    owner: string;
    repo: string;
    branch: string;
    baseCommitSha: string;
    message: string;
    files: GitHubFileCommit[];
  }): Promise<{ commitSha: string }>;
  createPullRequest(input: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<{ url: string; number: number }>;
}

export interface GitHubPrRemediationInput {
  proposal: FixProposal;
  execution: LocalRemediationExecution;
  target: GitHubRepositoryTarget;
  client: GitHubRemediationClient;
  now?: string;
}

export interface PullRequestBodyInput {
  proposal: FixProposal;
  execution: LocalRemediationExecution;
  filesChanged: string[];
}

export function createOctokitRemediationClient(token: string): GitHubRemediationClient {
  const octokit = new Octokit({ auth: token });

  return {
    async getBranchHead({ owner, repo, branch }) {
      const response = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`
      });
      return { sha: response.data.object.sha };
    },
    async createBranch({ owner, repo, ref, sha }) {
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref,
        sha
      });
    },
    async commitFiles({ owner, repo, branch, baseCommitSha, message, files }) {
      const baseCommit = await octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: baseCommitSha
      });

      const blobs = await Promise.all(
        files.map(async (file) => {
          const blob = await octokit.rest.git.createBlob({
            owner,
            repo,
            content: Buffer.from(file.content, "utf8").toString("base64"),
            encoding: "base64"
          });
          return {
            path: file.path,
            mode: "100644" as const,
            type: "blob" as const,
            sha: blob.data.sha
          };
        })
      );

      const tree = await octokit.rest.git.createTree({
        owner,
        repo,
        base_tree: baseCommit.data.tree.sha,
        tree: blobs
      });

      const commit = await octokit.rest.git.createCommit({
        owner,
        repo,
        message,
        tree: tree.data.sha,
        parents: [baseCommitSha]
      });

      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commit.data.sha,
        force: false
      });

      return { commitSha: commit.data.sha };
    },
    async createPullRequest({ owner, repo, title, body, head, base }) {
      const response = await octokit.rest.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
        draft: false
      });
      return { url: response.data.html_url, number: response.data.number };
    }
  };
}

export async function createGitHubPrRemediation(input: GitHubPrRemediationInput): Promise<GitHubPrRemediationResult> {
  const now = input.now ?? new Date().toISOString();
  const baseResult = {
    id: `ghpr_${input.proposal.id.replace(/[^a-zA-Z0-9]/g, "_")}`,
    fixProposalId: input.proposal.id,
    repositoryId: input.proposal.repositoryId,
    provider: "github" as const,
    branchName: null,
    pullRequestUrl: null,
    filesChanged: [],
    verificationSummary: createVerificationSummary(input.execution.verificationResult),
    createdAt: now
  };

  const blockReason = getGitHubPrBlockReason(input.proposal, input.execution);
  if (blockReason) {
    return {
      ...baseResult,
      status: "blocked",
      error: blockReason
    };
  }

  let filesChanged: string[];
  try {
    filesChanged = validateFilesChanged(input.proposal, input.execution);
  } catch {
    return {
      ...baseResult,
      status: "blocked",
      error: "Verified remediation included files outside the approved proposal."
    };
  }
  if (filesChanged.length === 0) {
    return {
      ...baseResult,
      status: "blocked",
      error: "No verified file changes were available for GitHub PR creation."
    };
  }

  const workingCopyPath = input.execution.workingCopyPath;
  if (!workingCopyPath) {
    return {
      ...baseResult,
      status: "blocked",
      error: GITHUB_PR_WORKING_COPY_ERROR
    };
  }

  const branchName = createRemediationBranchName(input.proposal, input.target.defaultBranch);
  if (branchName === input.target.defaultBranch) {
    return {
      ...baseResult,
      status: "blocked",
      error: "Remediation branch must not be the repository default branch."
    };
  }

  try {
    const head = await input.client.getBranchHead({
      owner: input.target.owner,
      repo: input.target.repo,
      branch: input.target.defaultBranch
    });
    await input.client.createBranch({
      owner: input.target.owner,
      repo: input.target.repo,
      ref: `refs/heads/${branchName}`,
      sha: head.sha
    });
    const files = await readVerifiedFiles(workingCopyPath, filesChanged);
    await input.client.commitFiles({
      owner: input.target.owner,
      repo: input.target.repo,
      branch: branchName,
      baseCommitSha: head.sha,
      message: createCommitMessage(input.proposal),
      files
    });
    const pullRequest = await input.client.createPullRequest({
      owner: input.target.owner,
      repo: input.target.repo,
      title: createPullRequestTitle(input.proposal),
      body: createPullRequestBody({ proposal: input.proposal, execution: input.execution, filesChanged }),
      head: branchName,
      base: input.target.defaultBranch
    });

    return {
      ...baseResult,
      status: "pr_created",
      branchName,
      pullRequestUrl: pullRequest.url,
      filesChanged,
      error: null
    };
  } catch {
    return {
      ...baseResult,
      status: "failed",
      branchName,
      pullRequestUrl: null,
      filesChanged,
      error: "GitHub PR creation failed."
    };
  }
}

export function createRemediationBranchName(proposal: FixProposal, defaultBranch: string): string {
  const slug = slugify(proposal.title || proposal.findingId || proposal.id).slice(0, 48).replace(/-$/g, "");
  const branchName = `autocyber/fix-${slug || "security-finding"}`;
  return branchName === defaultBranch ? `autocyber/fix-${proposal.id.replace(/[^a-zA-Z0-9]/g, "-")}` : branchName;
}

export function createPullRequestTitle(proposal: FixProposal): string {
  const cleanedTitle = proposal.title.replace(/^(add|remove|restrict|require|fix)\s+/i, "").trim();
  return `Fix ${cleanedTitle || "security finding"}`;
}

export function createPullRequestBody(input: PullRequestBodyInput): string {
  const verificationLines = input.execution.verificationResult?.checksRun.map((check) => `- ${check.name}: ${check.status} - ${check.outputSummary}`) ?? [
    "- Verification details were not provided."
  ];
  const limitationLines = input.execution.verificationResult?.limitations.map((limitation) => `- ${limitation}`) ?? [];

  return [
    "## What changed",
    input.proposal.proposedPatch,
    "",
    "Files changed:",
    ...input.filesChanged.map((file) => `- \`${file}\``),
    "",
    "## Why this matters",
    input.proposal.explanation,
    "",
    "## Verification",
    `Local verification status: ${input.execution.verificationResult?.status ?? "unknown"}`,
    ...verificationLines,
    "",
    "## Risk",
    input.proposal.risk,
    "",
    "## Notes",
    limitationLines.length > 0 ? limitationLines.join("\n") : "- No additional limitations recorded.",
    `- Source fix proposal: ${input.proposal.id}`,
    `- AutoCyber created this PR from branch \`${createRemediationBranchName(input.proposal, "main")}\` after human approval.`
  ].join("\n");
}

function createCommitMessage(proposal: FixProposal): string {
  return `${createPullRequestTitle(proposal)}\n\nGenerated by AutoCyber after approved local verification.`;
}

function validateFilesChanged(proposal: FixProposal, execution: LocalRemediationExecution): string[] {
  const allowedFiles = new Set(proposal.filesChanged);
  const files = Array.from(new Set(execution.filesChanged));
  const unexpectedFile = files.find((file) => !allowedFiles.has(file));
  if (unexpectedFile) {
    throw new Error(`Verified remediation touched unexpected file: ${unexpectedFile}`);
  }
  return files;
}

async function readVerifiedFiles(workingCopyPath: string, filesChanged: string[]): Promise<GitHubFileCommit[]> {
  return Promise.all(
    filesChanged.map(async (filePath) => ({
      path: filePath,
      content: await readFile(join(workingCopyPath, filePath), "utf8")
    }))
  );
}

function createVerificationSummary(result: RemediationVerificationResult | null): string {
  if (!result) return "Verification result was not provided.";
  return result.outputSummary;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
