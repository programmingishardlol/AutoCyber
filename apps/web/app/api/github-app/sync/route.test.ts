import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getPersistenceStore } from "../../../../lib/persistence/store";

const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

describe("GitHub App manual sync route", () => {
  beforeEach(() => {
    globalThis.__autocyberPersistenceStore = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("repairs an existing public repo row when GitHub App selected repos include it", async () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.replaceAll("\n", "\\n"));
    const store = getPersistenceStore();
    await store.upsertGitHubInstallation({
      installationId: "67890",
      teamId: "team_dev",
      userId: "user_dev",
      accountLogin: "acme",
      accountType: "github_account",
      status: "connected",
      repositorySelection: "selected",
      repositoryCount: 1,
      permissionsSummary: {
        contents: "read"
      }
    });
    const publicRepository = await store.upsertRepository({
      projectId: "proj_dev",
      provider: "github",
      owner: "acme",
      name: "repo-b",
      defaultBranch: "main",
      url: "https://github.com/acme/repo-b",
      connectionType: "public_github",
      canScan: true,
      canMonitor: false,
      canOpenPr: false,
      isPrivate: false
    });

    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      if (String(url).endsWith("/access_tokens")) {
        return new Response(JSON.stringify({ token: fakeGitHubInstallationToken("installation_secret_token") }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          repositories: [
            {
              name: "repo-b",
              full_name: "acme/repo-b",
              html_url: "https://github.com/acme/repo-b",
              private: true,
              default_branch: "main",
              owner: { login: "acme" },
              permissions: { contents: "read", pull_requests: "read" },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const response = await POST(
      new Request("http://localhost/api/github-app/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId: "67890" }),
      }),
    );
    const body = await response.json();
    const repositories = await store.listRepositories();

    expect(response.status).toBe(200);
    expect(body.repositoriesConnected).toBe(1);
    expect(repositories).toHaveLength(1);
    expect(repositories[0]).toMatchObject({
      id: publicRepository.id,
      connectionType: "github_app",
      installationId: "67890",
      isPrivate: true,
      canMonitor: true,
      canOpenPr: false,
    });
    expect(JSON.stringify(body)).not.toContain(fakeGitHubInstallationToken("installation_secret_token"));
    expect(JSON.stringify(body)).not.toContain(privateKey);
  });
});

function fakeGitHubInstallationToken(label: string): string {
  return ["ghs", label].join("_");
}
