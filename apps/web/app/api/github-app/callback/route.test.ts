import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getPersistenceStore } from "../../../../lib/persistence/store";

const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

describe("GitHub App callback route", () => {
  beforeEach(() => {
    globalThis.__autocyberPersistenceStore = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stores installation id and repository capabilities for selected GitHub App repos", async () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.replaceAll("\n", "\\n"));
    const fetchCalls: string[] = [];

    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      if (String(url).endsWith("/access_tokens")) {
        return new Response(
          JSON.stringify({
            token: fakeGitHubInstallationToken("installation_secret_token"),
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          repositories: [
            {
              name: "private-app",
              full_name: "acme/private-app",
              html_url: "https://github.com/acme/private-app",
              private: true,
              default_branch: "main",
              owner: { login: "acme" },
              permissions: {
                contents: "write",
                pull_requests: "write",
                metadata: "read",
              },
            },
            {
              name: "read-only-app",
              full_name: "acme/read-only-app",
              html_url: "https://github.com/acme/read-only-app",
              private: false,
              default_branch: "trunk",
              owner: { login: "acme" },
              permissions: {
                contents: "read",
                pull_requests: "read",
                metadata: "read",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const response = await GET(
      new Request(
        "http://localhost/api/github-app/callback?installation_id=67890",
      ),
    );
    const repeatResponse = await GET(
      new Request(
        "http://localhost/api/github-app/callback?installation_id=67890",
      ),
    );
    const body = await response.text();
    const repeatBody = await repeatResponse.text();
    const repositories = await getPersistenceStore().listRepositories();
    const installations = await getPersistenceStore().listGitHubInstallations();

    expect(response.status).toBe(200);
    expect(repeatResponse.status).toBe(200);
    expect(body).toContain("Installation complete");
    expect(body).toContain("2 repositories connected");
    expect(body).toContain("acme/private-app");
    expect(body).toContain("acme/read-only-app");
    expect(body).toContain("Private repository scanning is enabled");
    expect(body).toContain("Continuous monitoring is enabled");
    expect(body).toContain("GitHub App PR remediation is not implemented yet");
    expect(body).toContain("GitHub App Setup URL / Callback URL");
    expect(body).toContain("/api/github-app/callback");
    expect(body).toContain("View connected repositories");
    expect(body).toContain("Add another repository");
    expect(repeatBody).toContain("Installation complete");
    expect(installations).toHaveLength(1);
    expect(installations[0]).toMatchObject({
      installationId: "67890",
      teamId: "team_dev",
      userId: "user_dev",
      accountLogin: "acme",
      status: "connected",
      repositoryCount: 2,
      permissionsSummary: expect.objectContaining({
        contents: "write",
        pullRequests: "write",
        pullRequestWriteGranted: true,
        githubAppPrCreationImplemented: false,
      }),
    });
    expect(
      repositories.find((repo) => repo.name === "private-app"),
    ).toMatchObject({
      installationId: "67890",
      connectionType: "github_app",
      isPrivate: true,
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
      permissionsSummary: expect.objectContaining({
        contents: "write",
        pullRequests: "write",
        pullRequestWriteGranted: true,
        githubAppPrCreationImplemented: false,
      }),
    });
    expect(
      repositories.find((repo) => repo.name === "read-only-app"),
    ).toMatchObject({
      installationId: "67890",
      connectionType: "github_app",
      isPrivate: false,
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
    });
    expect(
      repositories.filter(
        (repo) => repo.owner === "acme" && repo.name === "private-app",
      ),
    ).toHaveLength(1);
    expect(
      repositories.filter(
        (repo) => repo.owner === "acme" && repo.name === "read-only-app",
      ),
    ).toHaveLength(1);
    expect(fetchCalls).toContain(
      "https://api.github.com/installation/repositories",
    );
    expect(JSON.stringify(body)).not.toContain(
      fakeGitHubInstallationToken("installation_secret_token"),
    );
    expect(JSON.stringify(body)).not.toContain(privateKey);
  });

  it("returns safe errors for missing installation ids", async () => {
    const response = await GET(
      new Request("http://localhost/api/github-app/callback"),
    );
    const body = await response.text();
    const store = getPersistenceStore();

    expect(response.status).toBe(400);
    expect(body).toContain("GitHub connection failed");
    expect(body).toContain("GitHub App installation_id is required.");
    expect(body).toContain("Try again");
    expect(body).toContain("/repositories/new");
    expect(body).not.toContain("Error:");
    expect(await store.listGitHubInstallations()).toHaveLength(0);
    expect(await store.listRepositories()).toHaveLength(0);
  });

  it("returns a safe error when GitHub App env vars are missing", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");

    const response = await GET(
      new Request(
        "http://localhost/api/github-app/callback?installation_id=67890",
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("GitHub connection failed");
    expect(body).toContain("GitHub App credentials are not configured.");
    expect(body).toContain("Try again");
    expect(body).not.toContain("BEGIN PRIVATE KEY");
    expect(body).not.toContain("ghs_");
  });

  it("marks repositories missing from a repeated installation callback as disconnected without deleting history", async () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.replaceAll("\n", "\\n"));
    let includeRemovedRepo = true;

    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      if (String(url).endsWith("/access_tokens")) {
        return new Response(JSON.stringify({ token: fakeGitHubInstallationToken("installation_secret_token") }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      const repositories = [
        {
          name: "repo-a",
          full_name: "acme/repo-a",
          html_url: "https://github.com/acme/repo-a",
          private: false,
          default_branch: "main",
          owner: { login: "acme" },
          permissions: { contents: "read", pull_requests: "read" },
        },
      ];
      if (includeRemovedRepo) {
        repositories.push({
          name: "repo-b",
          full_name: "acme/repo-b",
          html_url: "https://github.com/acme/repo-b",
          private: true,
          default_branch: "main",
          owner: { login: "acme" },
          permissions: { contents: "read", pull_requests: "read" },
        });
      }

      return new Response(JSON.stringify({ repositories }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await GET(new Request("http://localhost/api/github-app/callback?installation_id=67890"));
    includeRemovedRepo = false;
    await GET(new Request("http://localhost/api/github-app/callback?installation_id=67890"));

    const repositories = await getPersistenceStore().listRepositories();
    expect(repositories).toHaveLength(2);
    expect(repositories.find((repo) => repo.name === "repo-a")).toMatchObject({
      canScan: true,
      canMonitor: true,
    });
    expect(repositories.find((repo) => repo.name === "repo-b")).toMatchObject({
      canScan: false,
      canMonitor: false,
      canOpenPr: false,
      permissionsSummary: expect.objectContaining({
        accessRemovedFromInstallation: true,
      }),
    });
  });

  it("syncs newly added repositories on update callbacks and clears stale disconnected state", async () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.replaceAll("\n", "\\n"));
    const store = getPersistenceStore();
    await store.upsertRepository({
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
      isPrivate: false,
      permissionsSummary: {
        contents: "public_read"
      }
    });
    let includeRepoB = false;

    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      if (String(url).endsWith("/access_tokens")) {
        return new Response(JSON.stringify({ token: fakeGitHubInstallationToken("installation_secret_token") }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      const repositories = [
        {
          name: "repo-a",
          full_name: "acme/repo-a",
          html_url: "https://github.com/acme/repo-a",
          private: false,
          default_branch: "main",
          owner: { login: "acme" },
          permissions: { contents: "read", pull_requests: "read" },
        },
      ];
      if (includeRepoB) {
        repositories.push({
          name: "repo-b",
          full_name: "acme/repo-b",
          html_url: "https://github.com/acme/repo-b",
          private: true,
          default_branch: "main",
          owner: { login: "acme" },
          permissions: { contents: "read", pull_requests: "read" },
        });
      }

      return new Response(JSON.stringify({ repositories }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await GET(new Request("http://localhost/api/github-app/callback?setup_action=install&installation_id=67890"));

    includeRepoB = true;
    const updateResponse = await GET(new Request("http://localhost/api/github-app/callback?setup_action=update&installation_id=67890"));
    let repositories = await store.listRepositories();

    expect(updateResponse.status).toBe(200);
    expect(repositories.filter((repo) => repo.owner === "acme" && repo.name === "repo-b")).toHaveLength(1);
    expect(repositories.find((repo) => repo.name === "repo-b")).toMatchObject({
      connectionType: "github_app",
      installationId: "67890",
      isPrivate: true,
      canScan: true,
      canMonitor: true,
      canOpenPr: false,
      permissionsSummary: expect.objectContaining({
        accessRemovedFromInstallation: false,
        connectionStatus: "connected",
      }),
    });

    includeRepoB = false;
    await GET(new Request("http://localhost/api/github-app/callback?setup_action=update&installation_id=67890"));
    expect(await store.findGitHubRepository("acme", "repo-b")).toMatchObject({
      canMonitor: false,
      permissionsSummary: expect.objectContaining({
        accessRemovedFromInstallation: true,
        connectionStatus: "disconnected",
      }),
    });

    includeRepoB = true;
    await GET(new Request("http://localhost/api/github-app/callback?setup_action=update&installation_id=67890"));
    repositories = await store.listRepositories();
    expect(repositories.find((repo) => repo.name === "repo-b")).toMatchObject({
      canMonitor: true,
      permissionsSummary: expect.objectContaining({
        accessRemovedFromInstallation: false,
        connectionStatus: "connected",
      }),
    });
  });
});

function fakeGitHubInstallationToken(label: string): string {
  return ["ghs", label].join("_");
}
