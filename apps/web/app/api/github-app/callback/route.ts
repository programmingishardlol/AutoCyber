import { GitHubAppAuthError } from "../../../../lib/github-app-auth";
import { GitHubAppRepositoryError } from "../../../../lib/github-app-repositories";
import { syncGitHubAppInstallation } from "../../../../lib/github-app-sync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id")?.trim();

  if (!installationId) {
    return renderCallbackPage({
      status: 400,
      title: "GitHub connection failed",
      message: "GitHub App installation_id is required.",
      detail: "Try installing the GitHub App again from AutoCyber.",
      failure: true
    });
  }

  try {
    const syncResult = await syncGitHubAppInstallation(installationId);

    return renderCallbackPage({
      status: 200,
      title: "Installation complete",
      message: `${syncResult.repositoriesConnected} ${syncResult.repositoriesConnected === 1 ? "repository" : "repositories"} connected.`,
      detail: "Private repository scanning is enabled for private repositories selected during installation. Continuous monitoring is enabled for connected repositories. GitHub App PR remediation is not implemented yet. If connected repositories do not appear, confirm the GitHub App Setup URL / Callback URL points to /api/github-app/callback on this AutoCyber URL.",
      repositories: syncResult.repositories.map((repository) => `${repository.owner}/${repository.name}`)
    });
  } catch (error) {
    const message =
      error instanceof GitHubAppAuthError || error instanceof GitHubAppRepositoryError
        ? error.message
        : "AutoCyber could not complete the GitHub App connection.";

    return renderCallbackPage({
      status: 400,
      title: "GitHub connection failed",
      message,
      detail: "No token, private key, webhook secret, or internal stack trace was exposed.",
      failure: true
    });
  }
}

function renderCallbackPage(input: {
  status: number;
  title: string;
  message: string;
  detail: string;
  repositories?: string[];
  failure?: boolean;
}): Response {
  const repositoryItems = input.repositories?.length
    ? `<section><h2>Connected repositories</h2><ul>${input.repositories.map((repository) => `<li>${escapeHtml(repository)}</li>`).join("")}</ul></section>`
    : "";
  const primaryAction = input.failure
    ? `<a href="/repositories/new">Try again</a>`
    : `<a href="/repositories?connected=github">View connected repositories</a>`;
  const secondaryAction = input.failure ? "" : `<a class="secondary" href="/repositories/new?githubApp=connected">Add another repository</a>`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #020617; margin: 0; background: #f8fafc; }
      main { max-width: 720px; margin: 64px auto; padding: 32px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; }
      h1 { margin: 0 0 16px; font-size: 32px; line-height: 1.2; }
      h2 { margin: 24px 0 8px; font-size: 16px; }
      p { color: #475569; line-height: 1.6; }
      ul { color: #0f172a; line-height: 1.8; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
      a { display: inline-flex; padding: 10px 14px; border-radius: 6px; background: #020617; color: white; text-decoration: none; font-weight: 700; }
      a.secondary { background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.message)}</p>
      <p>${escapeHtml(input.detail)}</p>
      ${repositoryItems}
      <div class="actions">
        ${primaryAction}
        ${secondaryAction}
      </div>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status: input.status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
