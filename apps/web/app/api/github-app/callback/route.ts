import { NextResponse } from "next/server";
import { GitHubAppAuthError } from "../../../../lib/github-app-auth";
import { GitHubAppRepositoryError, listGitHubAppInstallationRepositories } from "../../../../lib/github-app-repositories";
import { getPersistenceStore } from "../../../../lib/persistence/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id")?.trim();

  if (!installationId) {
    return NextResponse.json(
      { error: "invalid GitHub App callback", message: "GitHub App installation_id is required." },
      { status: 400 }
    );
  }

  try {
    const selectedRepositories = await listGitHubAppInstallationRepositories(installationId);
    const store = getPersistenceStore();
    const repositories = [];

    for (const repository of selectedRepositories) {
      const record = await store.upsertRepository({
        projectId: "proj_dev",
        provider: "github",
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        url: repository.repoUrl,
        installationId,
        isPrivate: repository.isPrivate,
        connectionType: "github_app",
        canScan: repository.canScan,
        canMonitor: repository.canMonitor,
        canOpenPr: repository.canOpenPr,
        permissionsSummary: repository.permissionsSummary
      });

      repositories.push({
        owner: record.owner,
        name: record.name,
        isPrivate: record.isPrivate,
        canScan: record.canScan,
        canMonitor: record.canMonitor,
        canOpenPr: record.canOpenPr
      });
    }

    await store.writeAuditLog("github_app_connected", "github_installation", installationId);

    return NextResponse.json(
      {
        status: "connected",
        installationId,
        repositories
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof GitHubAppAuthError || error instanceof GitHubAppRepositoryError
        ? error.message
        : "AutoCyber could not complete the GitHub App connection.";

    return NextResponse.json({ error: "GitHub App connection failed", message }, { status: 400 });
  }
}
