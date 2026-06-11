import { NextResponse } from "next/server";
import { GitHubAppAuthError } from "../../../../lib/github-app-auth";
import { GitHubAppRepositoryError } from "../../../../lib/github-app-repositories";
import { syncGitHubAppInstallation } from "../../../../lib/github-app-sync";
import { getPersistenceStore } from "../../../../lib/persistence/store";

export const runtime = "nodejs";

type SyncInput = {
  installationId?: unknown;
};

export async function POST(request: Request) {
  const wantsHtml = request.headers.get("accept")?.includes("text/html") ?? false;

  try {
    const input = await readSyncInput(request);
    const store = getPersistenceStore();
    const installationIds =
      typeof input.installationId === "string" && input.installationId.trim()
        ? [input.installationId.trim()]
        : (await store.listGitHubInstallations()).filter((installation) => installation.status === "connected").map((installation) => installation.installationId);

    if (installationIds.length === 0) {
      return respond(
        request,
        wantsHtml,
        {
          error: "github app sync unavailable",
          message: "No connected GitHub App installations are available to sync."
        },
        400
      );
    }

    const results = [];
    for (const installationId of installationIds) {
      results.push(await syncGitHubAppInstallation(installationId));
    }

    return respond(
      request,
      wantsHtml,
      {
        results,
        repositoriesConnected: results.reduce((total, result) => total + result.repositoriesConnected, 0),
        repositoriesDisconnected: results.reduce((total, result) => total + result.repositoriesDisconnected, 0)
      },
      200
    );
  } catch (error) {
    const message =
      error instanceof GitHubAppAuthError || error instanceof GitHubAppRepositoryError
        ? error.message
        : "AutoCyber could not sync GitHub App repositories.";
    return respond(
      request,
      wantsHtml,
      {
        error: "github app sync failed",
        message
      },
      400
    );
  }
}

async function readSyncInput(request: Request): Promise<SyncInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as SyncInput;
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      installationId: form.get("installationId") ?? undefined
    };
  }

  return {};
}

function respond(request: Request, wantsHtml: boolean, body: Record<string, unknown>, status: number) {
  if (wantsHtml) {
    const url = new URL(status >= 200 && status < 300 ? "/repositories?sync=github" : "/repositories?sync=failed", request.url);
    return NextResponse.redirect(url, { status: 303 });
  }

  return NextResponse.json(body, { status });
}
