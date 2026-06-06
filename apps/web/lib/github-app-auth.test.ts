import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createInstallationAccessToken } from "./github-app-auth";

const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

describe("GitHub App installation auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a safe error when GitHub App env vars are missing", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");

    await expect(createInstallationAccessToken("123")).rejects.toMatchObject({
      code: "github_app_not_configured",
      message: "GitHub App credentials are not configured.",
    });
  });

  it("creates an installation token without exposing secrets", async () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey.replaceAll("\n", "\\n"));
    const fetchCalls: Array<{ url: string; authorization: string | null }> = [];

    const token = await createInstallationAccessToken("67890", {
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        fetchCalls.push({
          url: String(url),
          authorization: headers.get("authorization"),
        });
        return new Response(
          JSON.stringify({
            token: fakeGitHubInstallationToken("installation_secret_token"),
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(token).toBe(
      fakeGitHubInstallationToken("installation_secret_token"),
    );
    expect(fetchCalls[0]?.url).toBe(
      "https://api.github.com/app/installations/67890/access_tokens",
    );
    expect(fetchCalls[0]?.authorization).toMatch(/^Bearer /);
    expect(fetchCalls[0]?.authorization).not.toContain(privateKey);
  });

  it("returns safe errors when GitHub token creation fails", async () => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", privateKey);

    await expect(
      createInstallationAccessToken("67890", {
        fetch: async () =>
          new Response(
            JSON.stringify({
              message: `Bad credentials for ${fakeGitHubInstallationToken("secret_token")}`,
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            },
          ),
      }),
    ).rejects.toMatchObject({
      code: "github_app_token_failed",
      message: "AutoCyber could not create a GitHub App installation token.",
    });
  });
});

function fakeGitHubInstallationToken(label: string): string {
  return ["ghs", label].join("_");
}
