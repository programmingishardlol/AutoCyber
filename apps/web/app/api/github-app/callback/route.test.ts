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
    const body = await response.json();
    const repeatBody = await repeatResponse.json();
    const repositories = await getPersistenceStore().listRepositories();

    expect(response.status).toBe(200);
    expect(repeatResponse.status).toBe(200);
    expect(body.status).toBe("connected");
    expect(repeatBody.status).toBe("connected");
    expect(body.repositories).toEqual([
      {
        owner: "acme",
        name: "private-app",
        isPrivate: true,
        canScan: true,
        canMonitor: true,
        canOpenPr: true,
      },
      {
        owner: "acme",
        name: "read-only-app",
        isPrivate: false,
        canScan: true,
        canMonitor: true,
        canOpenPr: false,
      },
    ]);
    expect(
      repositories.find((repo) => repo.name === "private-app"),
    ).toMatchObject({
      installationId: "67890",
      connectionType: "github_app",
      isPrivate: true,
      canScan: true,
      canMonitor: true,
      canOpenPr: true,
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
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid GitHub App callback");
    expect(JSON.stringify(body)).not.toContain("Error:");
  });

  it("returns a safe error when GitHub App env vars are missing", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");

    const response = await GET(
      new Request(
        "http://localhost/api/github-app/callback?installation_id=67890",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("GitHub App connection failed");
    expect(body.message).toBe("GitHub App credentials are not configured.");
    expect(JSON.stringify(body)).not.toContain("BEGIN PRIVATE KEY");
    expect(JSON.stringify(body)).not.toContain("ghs_");
  });
});

function fakeGitHubInstallationToken(label: string): string {
  return ["ghs", label].join("_");
}
