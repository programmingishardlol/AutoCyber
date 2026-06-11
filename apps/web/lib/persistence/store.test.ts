import { describe, expect, it } from "vitest";
import type { FixProposal, PullRequestRecord } from "@autocyber/core";
import { createDevPersistenceStore } from "./store";

describe("Stage 5D persistence store", () => {
  it("persists repository, scan, finding, memory, and audit records in dev fallback mode", async () => {
    const store = createDevPersistenceStore();
    const repository = await store.upsertRepository({
      projectId: "proj_demo",
      provider: "github",
      owner: "openai",
      name: "codex",
      defaultBranch: "main",
      url: "https://github.com/openai/codex"
    });
    const scanJob = await store.createScanJob({
      repositoryId: repository.id,
      source: "manual",
      branch: "main",
      commitSha: "unknown"
    });

    await store.completeScanJob(scanJob.id, { critical: 0, high: 1, medium: 0, low: 0, info: 0 });
    await store.saveFindings([
      {
        id: "finding_secret",
        repositoryId: repository.id,
        scanJobId: scanJob.id,
        ruleId: "exposed-secret",
        title: "Potential secret committed to repository",
        category: "secrets",
        severity: "high",
        confidence: 0.95,
        status: "open",
        stackTags: ["node"],
        affectedFile: ".env",
        evidence: [{ filePath: ".env", startLine: 1, endLine: 1, snippet: "OPENAI_API_KEY=sk-[REDACTED]" }],
        riskExplanation: "Leaked secrets can be abused.",
        remediationSummary: "Remove and rotate the key.",
        verificationStrategy: "Rerun scanner.",
        autofixAvailable: false
      }
    ]);
    await store.upsertRepoProfileMemory(repository.id, {
      frameworks: ["nextjs"],
      languages: ["typescript"],
      integrations: ["openai"],
      deploymentProviders: ["vercel"],
      packageManagers: ["pnpm"]
    });

    const snapshot = store.snapshot();
    expect(snapshot.repositories).toHaveLength(1);
    expect(snapshot.scanJobs[0]?.status).toBe("completed");
    expect(snapshot.findings).toHaveLength(1);
    expect(snapshot.securityMemories[0]?.kind).toBe("repo_profile");
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual([
      "repo_created",
      "scan_started",
      "scan_completed",
      "finding_created"
    ]);
  });

  it("persists GitHub App installation metadata separately from repository records", async () => {
    const store = createDevPersistenceStore();
    const installation = await store.upsertGitHubInstallation({
      installationId: "123456",
      teamId: "team_dev",
      userId: "user_dev",
      accountLogin: "openai",
      accountType: "github_account",
      status: "connected",
      repositorySelection: "selected",
      repositoryCount: 1,
      permissionsSummary: {
        contents: "write",
        pullRequests: "write",
        githubAppPrCreationImplemented: false
      }
    });
    const repository = await store.upsertRepository({
      projectId: "proj_demo",
      provider: "github",
      owner: "openai",
      name: "private-codex",
      defaultBranch: "main",
      url: "https://github.com/openai/private-codex",
      installationId: "123456",
      isPrivate: true
    });

    expect(installation).toMatchObject({
      installationId: "123456",
      teamId: "team_dev",
      userId: "user_dev",
      status: "connected",
      repositoryCount: 1
    });
    expect(repository).toMatchObject({
      installationId: "123456",
      isPrivate: true
    });
    await expect(store.getGitHubInstallation("123456")).resolves.toMatchObject({
      accountLogin: "openai",
      permissionsSummary: expect.objectContaining({
        contents: "write",
        githubAppPrCreationImplemented: false
      })
    });
    await expect(store.findGitHubRepository("openai", "private-codex")).resolves.toMatchObject({
      installationId: "123456",
      isPrivate: true
    });
  });

  it("does not downgrade installed GitHub App repositories when a later public URL scan upserts the same repo", async () => {
    const store = createDevPersistenceStore();
    const installedRepository = await store.upsertRepository({
      projectId: "proj_demo",
      provider: "github",
      owner: "openai",
      name: "private-codex",
      defaultBranch: "main",
      url: "https://github.com/openai/private-codex",
      installationId: "123456",
      isPrivate: true,
      connectionType: "github_app",
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
      permissionsSummary: {
        contents: "read",
        pullRequests: "read"
      }
    });

    const updatedRepository = await store.upsertRepository({
      projectId: "proj_demo",
      provider: "github",
      owner: "openai",
      name: "private-codex",
      defaultBranch: "main",
      url: "https://github.com/openai/private-codex",
      connectionType: "public_github",
      canScan: true,
      canMonitor: false,
      canOpenPr: false,
      isPrivate: false,
      permissionsSummary: {
        contents: "public_read",
        pullRequests: "none"
      }
    });

    expect(updatedRepository.id).toBe(installedRepository.id);
    expect(updatedRepository).toMatchObject({
      connectionType: "github_app",
      installationId: "123456",
      isPrivate: true,
      canScan: true,
      canMonitor: true,
      canOpenPr: false
    });
  });

  it("uses canonical GitHub identity so public and GitHub App rows for the same repo do not duplicate", async () => {
    const store = createDevPersistenceStore();
    const publicRepository = await store.upsertRepository({
      projectId: "proj_demo",
      provider: "github",
      owner: "OpenAI",
      name: "Codex",
      defaultBranch: "main",
      url: "https://github.com/OpenAI/Codex",
      connectionType: "public_github",
      canScan: true,
      canMonitor: false,
      canOpenPr: false,
      isPrivate: false
    });
    const installedRepository = await store.upsertRepository({
      projectId: "proj_demo",
      provider: "github",
      owner: "openai",
      name: "codex",
      defaultBranch: "main",
      url: "https://github.com/openai/codex",
      installationId: "123456",
      isPrivate: true,
      connectionType: "github_app",
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
      permissionsSummary: {
        contents: "read",
        connectionStatus: "connected"
      }
    });

    expect(installedRepository.id).toBe(publicRepository.id);
    expect(store.snapshot().repositories).toHaveLength(1);
    expect(await store.findGitHubRepository("OPENAI", "CODEX")).toMatchObject({
      id: publicRepository.id,
      connectionType: "github_app",
      installationId: "123456",
      isPrivate: true,
      canMonitor: true
    });
  });

  it("records fix decisions, verification results, and PR audit events in dev fallback mode", async () => {
    const store = createDevPersistenceStore();
    const proposal: FixProposal = {
      id: "fix_demo",
      findingId: "finding_demo",
      repositoryId: "repo_demo",
      status: "approved",
      kind: "patch",
      title: "Fix demo finding",
      explanation: "Apply a narrow deterministic patch.",
      proposedPatch: "Patch demo finding.",
      diff: "--- a/app.ts\n+++ b/app.ts\n@@\n-old\n+new",
      risk: "Low.",
      verificationPlan: ["Rerun scanner."],
      filesChanged: ["app.ts"],
      createdAt: "2026-06-03T10:00:00.000Z",
      updatedAt: "2026-06-03T10:00:00.000Z"
    };
    const pullRequest: PullRequestRecord = {
      id: "pr_demo",
      fixProposalId: proposal.id,
      repositoryId: proposal.repositoryId,
      status: "open",
      branchName: "autocyber/fix-demo",
      title: proposal.title,
      summary: "Verification passed.",
      url: "https://github.com/example/repo/pull/1",
      createdAt: "2026-06-03T10:03:00.000Z",
      updatedAt: "2026-06-03T10:03:00.000Z"
    };

    await store.saveFixProposal(proposal);
    await store.saveVerificationResult({
      id: "verification_demo",
      fixProposalId: proposal.id,
      status: "passed",
      scannerRerunStatus: "passed",
      testCommand: "Test command was not run.",
      testOutputSummary: "scanner-rule passed",
      evidence: ["scanner-rule: passed"],
      createdAt: "2026-06-03T10:02:00.000Z",
      updatedAt: "2026-06-03T10:02:00.000Z"
    });
    await store.savePullRequest(pullRequest);

    const snapshot = store.snapshot();
    expect(snapshot.fixProposals[0]?.status).toBe("approved");
    expect(snapshot.verificationResults[0]?.status).toBe("passed");
    expect(snapshot.pullRequests[0]?.id).toBe(pullRequest.id);
    expect(snapshot.securityMemories.map((memory) => memory.kind)).toContain("accepted_fix");
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual([
      "fix_proposal_created",
      "proposal_approved",
      "local_remediation_completed",
      "github_pr_created"
    ]);
  });
});
