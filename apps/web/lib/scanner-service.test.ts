import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScannerResult } from "@autocyber/scanner";
import {
  clonePublicGitHubRepository,
  GitHubIngestionError,
} from "./github-ingestion";
import { cloneGitHubRepositoryWithInstallationToken } from "./github-private-ingestion";
import { getPersistenceStore } from "./persistence/store";
import { runScan } from "./scanner-service";

describe("scanner service GitHub App manual scans", () => {
  beforeEach(() => {
    globalThis.__autocyberPersistenceStore = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("scans an installed private GitHub App repository by URL without downgrading capabilities", async () => {
    const clonedRepo = await createFixtureRepo("privateapp");
    const store = getPersistenceStore();
    const installedRepository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "acme",
      name: "private-app",
      defaultBranch: "main",
      url: "https://github.com/acme/private-app",
      installationId: "67890",
      isPrivate: true,
      connectionType: "github_app",
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
      permissionsSummary: {
        contents: "read",
        pullRequests: "read",
      },
    });
    const cloneInstalledRepository = vi.fn(
      async (
        input: Parameters<typeof cloneGitHubRepositoryWithInstallationToken>[0],
      ) => {
        expect(input.repoUrl).toBe("https://github.com/acme/private-app");
        expect(input.installationId).toBe("67890");
        return input.scan(clonedRepo);
      },
    );

    const result = await runScan(
      {
        source: "github",
        repoUrl: "https://github.com/acme/private-app",
      },
      {
        cloneInstalledRepository:
          cloneInstalledRepository as typeof cloneGitHubRepositoryWithInstallationToken,
      },
    );

    const body = result.body;
    const persistedRepository = await store.findGitHubRepository(
      "acme",
      "private-app",
    );

    expect(result.status).toBe(200);
    expect(cloneInstalledRepository).toHaveBeenCalledTimes(1);
    expect("repository" in body ? body.repository.id : null).toBe(
      installedRepository.id,
    );
    expect("repository" in body ? body.repository.connectionType : null).toBe(
      "github_app",
    );
    expect("repository" in body ? body.repository.installationId : null).toBe(
      "67890",
    );
    expect("repository" in body ? body.repository.isPrivate : null).toBe(true);
    expect("repository" in body ? body.repository.canMonitor : null).toBe(true);
    expect(
      "findings" in body
        ? body.findings.some((finding) => finding.ruleId === "exposed-secret")
        : false,
    ).toBe(true);
    expect(persistedRepository).toMatchObject({
      connectionType: "github_app",
      installationId: "67890",
      isPrivate: true,
      canMonitor: true,
    });
    expect(JSON.stringify(body)).not.toContain(
      "privateapp000000000000000000000000000000",
    );
  });

  it("uses the installed GitHub App path when an older public-scan row still has an installation id", async () => {
    const clonedRepo = await createFixtureRepo("staleprivateapp");
    const store = getPersistenceStore();
    const staleInstalledRepository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "acme",
      name: "stale-private-app",
      defaultBranch: "main",
      url: "https://github.com/acme/stale-private-app",
      installationId: "67890",
      isPrivate: true,
      connectionType: "github_app",
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
      permissionsSummary: {
        contents: "read",
      },
    });
    await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "acme",
      name: "stale-private-app",
      defaultBranch: "main",
      url: "https://github.com/acme/stale-private-app",
      connectionType: "public_github",
      canScan: true,
      canMonitor: false,
      canOpenPr: false,
      isPrivate: false,
      permissionsSummary: {
        contents: "public_read",
      },
    });
    const cloneInstalledRepository = vi.fn(
      async (
        input: Parameters<typeof cloneGitHubRepositoryWithInstallationToken>[0],
      ) => {
        expect(input.repoUrl).toBe("https://github.com/acme/stale-private-app");
        expect(input.installationId).toBe("67890");
        return input.scan(clonedRepo);
      },
    );
    const clonePublicRepository = vi.fn(async () => {
      throw new Error("public clone should not run for installed repositories");
    });

    const result = await runScan(
      {
        source: "github",
        repoUrl: "https://github.com/acme/stale-private-app",
      },
      {
        cloneInstalledRepository:
          cloneInstalledRepository as typeof cloneGitHubRepositoryWithInstallationToken,
        clonePublicRepository,
      },
    );

    const body = result.body;
    const persistedRepository = await store.findGitHubRepository(
      "acme",
      "stale-private-app",
    );

    expect(result.status).toBe(200);
    expect("repository" in body ? body.repository.id : null).toBe(
      staleInstalledRepository.id,
    );
    expect(cloneInstalledRepository).toHaveBeenCalledTimes(1);
    expect(clonePublicRepository).not.toHaveBeenCalled();
    expect(persistedRepository).toMatchObject({
      connectionType: "github_app",
      installationId: "67890",
      isPrivate: true,
      canMonitor: true,
      canOpenPr: false,
    });
  });

  it("keeps public GitHub URL scans on the public clone path when no installation exists", async () => {
    const clonedRepo = await createFixtureRepo("publicapp");
    const clonePublicRepository = vi.fn(
      async (input: Parameters<typeof clonePublicGitHubRepository>[0]) => {
        expect(input.repoUrl).toBe("https://github.com/acme/public-app");
        return input.scan(clonedRepo);
      },
    );

    const result = await runScan(
      {
        source: "github",
        repoUrl: "https://github.com/acme/public-app",
      },
      {
        clonePublicRepository:
          clonePublicRepository as typeof clonePublicGitHubRepository,
      },
    );

    const body = result.body;

    expect(result.status).toBe(200);
    expect(clonePublicRepository).toHaveBeenCalledTimes(1);
    expect("repository" in body ? body.repository.connectionType : null).toBe(
      "public_github",
    );
    expect("repository" in body ? body.repository.canOpenPr : null).toBe(false);
  });

  it("does not use the test clone path override for public GitHub URL scans", async () => {
    const testOverrideRepo = await createFixtureRepo("overridebait");
    const clonedRepo = await createFixtureRepo("realpublicapp");
    const clonePublicRepository = vi.fn(
      async (input: Parameters<typeof clonePublicGitHubRepository>[0]) => {
        return input.scan(clonedRepo);
      },
    );
    vi.stubEnv("AUTOCYBER_TEST_GITHUB_CLONE_PATH", testOverrideRepo);

    const result = await runScan(
      {
        source: "github",
        repoUrl: "https://github.com/acme/public-app",
      },
      {
        clonePublicRepository:
          clonePublicRepository as typeof clonePublicGitHubRepository,
      },
    );
    vi.unstubAllEnvs();

    const body = result.body;

    expect(result.status).toBe(200);
    expect(clonePublicRepository).toHaveBeenCalledTimes(1);
    expect("result" in body ? body.result?.repositoryPath : null).toBe(
      clonedRepo,
    );
    expect(JSON.stringify(body)).not.toContain("overridebait");
  });

  it("normalizes helper output to the active repository and scan context before persistence", async () => {
    const result = await runScan(
      {
        source: "github",
        repoUrl: "https://github.com/acme/context-app",
      },
      {
        clonePublicRepository: async <T>() =>
          createScannerResult({
            repositoryId: "repo_helper",
            scanJobId: "scan_helper",
            findingId: "finding_helper_plain",
            findingRepositoryId: "repo_helper",
            findingScanJobId: "scan_helper",
          }) as T,
      },
    );
    const body = result.body;
    const store = getPersistenceStore();

    expect(result.status).toBe(200);
    if (!("repository" in body)) throw new Error("Expected scan response.");
    const persistedFindings = store
      .snapshot()
      .findings.filter((finding) => finding.ruleId === "missing-api-auth");
    expect(
      body.findings.every(
        (finding) => finding.repositoryId === body.repository.id,
      ),
    ).toBe(true);
    expect(
      body.findings.every((finding) => finding.scanJobId === body.scanJob.id),
    ).toBe(true);
    expect(
      persistedFindings.every(
        (finding) => finding.repositoryId === body.repository.id,
      ),
    ).toBe(true);
    expect(
      persistedFindings.every(
        (finding) => finding.scanJobId === body.scanJob.id,
      ),
    ).toBe(true);
  });

  it("fails safely for a private GitHub URL with no matching installed repository", async () => {
    const clonePublicRepository = vi.fn(async () => {
      throw new GitHubIngestionError(
        "unreachable_public_repo",
        "AutoCyber could not access that public repository. Private GitHub monitoring requires a connected GitHub App installation.",
      );
    });

    const result = await runScan(
      {
        source: "github",
        repoUrl: "https://github.com/acme/private-app",
      },
      {
        clonePublicRepository:
          clonePublicRepository as typeof clonePublicGitHubRepository,
      },
    );

    expect(result.status).toBe(400);
    expect(result.body.message).toContain("GitHub App installation");
    expect(JSON.stringify(result.body)).not.toContain("Error:");
  });

  it("does not leak installation tokens if installed repo clone fails", async () => {
    const store = getPersistenceStore();
    await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "acme",
      name: "private-app",
      defaultBranch: "main",
      url: "https://github.com/acme/private-app",
      installationId: "67890",
      isPrivate: true,
      connectionType: "github_app",
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
      permissionsSummary: {
        contents: "read",
      },
    });

    const result = await runScan(
      {
        source: "github",
        repoUrl: "https://github.com/acme/private-app",
      },
      {
        cloneInstalledRepository: vi.fn(async () => {
          throw new Error(
            `clone failed with ${fakeGitHubInstallationToken("private_installation_token")}`,
          );
        }) as typeof cloneGitHubRepositoryWithInstallationToken,
      },
    );

    const snapshot = store.snapshot();

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain(
      fakeGitHubInstallationToken("private_installation_token"),
    );
    expect(JSON.stringify(snapshot.scanJobs)).not.toContain(
      fakeGitHubInstallationToken("private_installation_token"),
    );
  });
});

async function createFixtureRepo(label: string): Promise<string> {
  const repositoryPath = await mkdtemp(
    join(tmpdir(), "autocyber-scanner-service-"),
  );
  await writeFile(
    join(repositoryPath, "package.json"),
    JSON.stringify({ dependencies: { next: "latest" } }),
  );
  await writeFile(
    join(repositoryPath, ".env"),
    `OPENAI_API_KEY=${fakeOpenAiKey(label)}`,
  );
  return repositoryPath;
}

function createScannerResult(input: {
  repositoryId: string;
  scanJobId: string;
  findingId: string;
  findingRepositoryId: string;
  findingScanJobId: string;
}): ScannerResult {
  return {
    scanner: "local",
    repositoryPath: "/tmp/helper-output",
    repositoryId: input.repositoryId,
    scanJobId: input.scanJobId,
    projectProfile: {
      frameworks: ["nextjs"],
      languages: ["typescript"],
      integrations: [],
      deploymentProviders: [],
      packageManagers: ["pnpm"],
    },
    findings: [
      {
        id: input.findingId,
        repositoryId: input.findingRepositoryId,
        scanJobId: input.findingScanJobId,
        ruleId: "missing-api-auth",
        title: "API route does not enforce authentication",
        category: "missing-auth",
        severity: "high",
        confidence: 0.84,
        status: "open",
        stackTags: ["nextjs"],
        affectedFile: "app/api/demo/route.ts",
        evidence: [
          {
            filePath: "app/api/demo/route.ts",
            startLine: 1,
            endLine: 1,
            snippet: "export async function GET() {}",
          },
        ],
        riskExplanation:
          "Sensitive API routes without a server-side user check can expose application data.",
        remediationSummary:
          "Require server-side authentication before returning sensitive data.",
        verificationStrategy: "Rerun scanner.",
        autofixAvailable: true,
      },
    ],
    filesScanned: 1,
    rulesRun: ["missing-api-auth"],
    errors: [],
  };
}

function fakeOpenAiKey(label: string): string {
  return ["sk", "proj", `${label}000000000000000000000000000000`].join("-");
}

function fakeGitHubInstallationToken(label: string): string {
  return ["ghs", label].join("_");
}
