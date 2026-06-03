import { NextResponse } from "next/server";
import {
  createGitHubPrRemediation,
  createOctokitRemediationClient,
  getGitHubPrBlockReason,
  type GitHubRepositoryTarget,
  type LocalRemediationExecution
} from "@autocyber/remediation";
import type { FixProposal } from "@autocyber/core";
import { getPersistenceStore } from "../../../lib/persistence/store";

export const runtime = "nodejs";

interface GitHubPrRequest {
  proposal?: FixProposal;
  execution?: LocalRemediationExecution;
  target?: Partial<GitHubRepositoryTarget>;
}

export async function POST(request: Request) {
  let input: GitHubPrRequest;

  try {
    input = (await request.json()) as GitHubPrRequest;
  } catch {
    return NextResponse.json({ error: "invalid GitHub PR input", message: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!input.proposal || !input.execution || !input.target) {
    return NextResponse.json(
      { error: "invalid GitHub PR input", message: "An approved proposal, verified remediation execution, and GitHub repository target are required." },
      { status: 400 }
    );
  }

  const blockReason = getGitHubPrBlockReason(input.proposal, input.execution);
  if (blockReason) {
    return NextResponse.json({ error: "GitHub PR blocked", message: blockReason }, { status: 400 });
  }

  const target = normalizeTarget(input.target);
  if (!target) {
    return NextResponse.json(
      { error: "invalid GitHub repository target", message: "Owner, repo, and default branch are required for GitHub PR creation." },
      { status: 400 }
    );
  }

  if (target.tokenMode === "github-app") {
    return NextResponse.json(
      { error: "GitHub App mode unavailable", message: "GitHub App installation token exchange is a Stage 4B placeholder. Use token mode for local test repos." },
      { status: 400 }
    );
  }

  const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_FINE_GRAINED_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GitHub token not configured", message: "Set GITHUB_TOKEN to a fine-grained local development token with contents and pull request permissions." },
      { status: 400 }
    );
  }

  const result = await createGitHubPrRemediation({
    proposal: input.proposal,
    execution: input.execution,
    target,
    client: createOctokitRemediationClient(token)
  });
  if (result.status === "pr_created") {
    await getPersistenceStore().savePullRequest({
      id: result.id,
      fixProposalId: result.fixProposalId,
      repositoryId: result.repositoryId,
      status: "open",
      branchName: result.branchName ?? "",
      title: input.proposal.title,
      summary: result.verificationSummary,
      url: result.pullRequestUrl,
      createdAt: result.createdAt,
      updatedAt: result.createdAt
    });
  }

  return NextResponse.json({ pullRequest: result }, { status: result.status === "pr_created" ? 200 : 400 });
}

function normalizeTarget(target: Partial<GitHubRepositoryTarget>): GitHubRepositoryTarget | null {
  const owner = target.owner?.trim();
  const repo = target.repo?.trim();
  const defaultBranch = target.defaultBranch?.trim() || "main";
  if (!owner || !repo || !defaultBranch) return null;

  return {
    owner,
    repo,
    defaultBranch,
    tokenMode: target.tokenMode === "github-app" ? "github-app" : "token",
    installationId: target.installationId,
    repoUrl: target.repoUrl?.trim() || `https://github.com/${owner}/${repo}`
  };
}
