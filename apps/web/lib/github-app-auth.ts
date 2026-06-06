import { createSign } from "node:crypto";

export class GitHubAppAuthError extends Error {
  constructor(
    public readonly code: "github_app_not_configured" | "github_app_invalid_private_key" | "github_app_token_failed",
    message: string
  ) {
    super(message);
  }
}

export interface CreateInstallationAccessTokenOptions {
  fetch?: typeof fetch;
}

export async function createInstallationAccessToken(
  installationId: string,
  options: CreateInstallationAccessTokenOptions = {}
): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY);

  if (!appId || !privateKey) {
    throw new GitHubAppAuthError("github_app_not_configured", "GitHub App credentials are not configured.");
  }

  const jwt = createGitHubAppJwt(appId, privateKey);
  const requestFetch = options.fetch ?? fetch;
  const response = await requestFetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "x-github-api-version": "2022-11-28"
    }
  });

  if (!response.ok) {
    throw new GitHubAppAuthError("github_app_token_failed", "AutoCyber could not create a GitHub App installation token.");
  }

  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) {
    throw new GitHubAppAuthError("github_app_token_failed", "AutoCyber could not create a GitHub App installation token.");
  }

  return body.token;
}

function createGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId
    })
  );
  const signingInput = `${header}.${payload}`;

  try {
    const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
    return `${signingInput}.${base64url(signature)}`;
  } catch {
    throw new GitHubAppAuthError("github_app_invalid_private_key", "GitHub App private key is invalid.");
  }
}

function normalizePrivateKey(value: string | undefined): string | null {
  if (!value) return null;
  return value.replaceAll("\\n", "\n");
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
