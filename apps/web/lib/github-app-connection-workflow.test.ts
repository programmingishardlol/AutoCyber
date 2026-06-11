import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as githubAppCallback } from "../app/api/github-app/callback/route";
import { GitHubIngestionError } from "./github-ingestion";
import { cloneGitHubRepositoryWithInstallationToken } from "./github-private-ingestion";
import { getPersistenceStore } from "./persistence/store";
import { runScan } from "./scanner-service";

const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
}).privateKey;

describe("GitHub App connection workflow", () => {
  beforeEach(() => {
    globalThis.__autocyberPersistenceStore = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows connected repos only after GitHub redirects to the callback with an installation id", async () => {
    const store = getPersistenceStore();
    const selectedRepoUrl = "https://github.com/acme/private-app";
    const clonedRepo = await createFixtureRepo();

    const beforeCallbackScan = await runScan(
      {
        source: "github",
        repoUrl: selectedRepoUrl
      },
      {
        clonePublicRepository: vi.fn(async () => {
          throw new GitHubIngestionError(
            "unreachable_public_repo",
            "AutoCyber could not access that public repository. Private GitHub monitoring requires a connected GitHub App installation."
          );
        })
      }
    );

    expect(beforeCallbackScan.status).toBe(400);
    expect(beforeCallbackScan.body.message).toContain("GitHub App installation");
    expect(await store.listGitHubInstallations()).toHaveLength(0);
    expect((await store.listRepositories()).filter((repo) => repo.connectionType === "github_app")).toHaveLength(0);

    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.replaceAll("\n", "\\n"));
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      if (String(url).endsWith("/access_tokens")) {
        return new Response(JSON.stringify({ token: fakeGitHubInstallationToken("installation_secret_token") }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(
        JSON.stringify({
          repositories: [
            {
              name: "private-app",
              full_name: "acme/private-app",
              html_url: selectedRepoUrl,
              private: true,
              default_branch: "main",
              owner: { login: "acme" },
              permissions: {
                contents: "read",
                pull_requests: "read",
                metadata: "read"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });

    const callbackResponse = await githubAppCallback(new Request("http://localhost/api/github-app/callback?installation_id=67890"));
    const callbackBody = await callbackResponse.text();
    const repositoriesAfterCallback = await store.listRepositories();

    expect(callbackResponse.status).toBe(200);
    expect(callbackBody).toContain("Installation complete");
    expect(callbackBody).toContain("acme/private-app");
    expect(await store.listGitHubInstallations()).toHaveLength(1);
    expect(repositoriesAfterCallback.filter((repo) => repo.connectionType === "github_app")).toHaveLength(1);
    expect(repositoriesAfterCallback.find((repo) => repo.name === "private-app")).toMatchObject({
      connectionType: "github_app",
      installationId: "67890",
      isPrivate: true,
      canScan: true,
      canMonitor: true,
      canOpenPr: false
    });

    const cloneInstalledRepository = vi.fn(async (input: Parameters<typeof cloneGitHubRepositoryWithInstallationToken>[0]) => {
      expect(input.repoUrl).toBe(selectedRepoUrl);
      expect(input.installationId).toBe("67890");
      return input.scan(clonedRepo);
    });

    const afterCallbackScan = await runScan(
      {
        source: "github",
        repoUrl: selectedRepoUrl
      },
      {
        cloneInstalledRepository: cloneInstalledRepository as typeof cloneGitHubRepositoryWithInstallationToken
      }
    );

    expect(afterCallbackScan.status).toBe(200);
    expect(cloneInstalledRepository).toHaveBeenCalledTimes(1);
    expect("repository" in afterCallbackScan.body ? afterCallbackScan.body.repository.connectionType : null).toBe("github_app");
    expect("findings" in afterCallbackScan.body ? afterCallbackScan.body.findings.some((finding) => finding.ruleId === "exposed-secret") : false).toBe(true);
    expect(JSON.stringify(afterCallbackScan.body)).not.toContain(fakeGitHubInstallationToken("installation_secret_token"));
  });
});

async function createFixtureRepo(): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), "autocyber-github-app-workflow-"));
  await writeFile(join(repositoryPath, "package.json"), JSON.stringify({ dependencies: { next: "latest" } }));
  await writeFile(join(repositoryPath, ".env"), `OPENAI_API_KEY=${fakeOpenAiKey("workflow")}`);
  return repositoryPath;
}

function fakeOpenAiKey(label: string): string {
  return ["sk", "proj", `${label}000000000000000000000000000000`].join("-");
}

function fakeGitHubInstallationToken(label: string): string {
  return ["ghs", label].join("_");
}
