import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getPersistenceStore } from "../../../../lib/persistence/store";
import { enqueueScanJob, processScanJob } from "../../../../lib/scan-queue";

export const runtime = "nodejs";

type SupportedGitHubEvent = "push" | "pull_request";

interface GitHubRepositoryPayload {
  name?: string;
  full_name?: string;
  html_url?: string;
  clone_url?: string;
  default_branch?: string;
  owner?: {
    login?: string;
  };
}

interface GitHubPushPayload {
  ref?: string;
  after?: string;
  head_commit?: {
    id?: string;
  };
  repository?: GitHubRepositoryPayload;
}

interface GitHubPullRequestPayload {
  number?: number;
  pull_request?: {
    number?: number;
    head?: {
      ref?: string;
      sha?: string;
    };
  };
  repository?: GitHubRepositoryPayload;
}

export async function POST(request: Request) {
  const store = getPersistenceStore();
  const deliveryId = request.headers.get("x-github-delivery") ?? "missing_delivery";
  const event = request.headers.get("x-github-event") ?? "";
  const signature = request.headers.get("x-hub-signature-256");
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const rawBody = await request.text();

  if (!secret) {
    await store.writeAuditLog("webhook_rejected", "github_delivery", deliveryId);
    return NextResponse.json(
      {
        error: "GitHub webhook secret not configured",
        message: "GitHub webhook processing is not configured for this environment."
      },
      { status: 503 }
    );
  }

  if (!signature) {
    await store.writeAuditLog("webhook_rejected", "github_delivery", deliveryId);
    return NextResponse.json(
      {
        error: "missing GitHub webhook signature",
        message: "GitHub webhook requests must include a valid X-Hub-Signature-256 header."
      },
      { status: 401 }
    );
  }

  if (!isValidGitHubSignature(rawBody, signature, secret)) {
    await store.writeAuditLog("webhook_rejected", "github_delivery", deliveryId);
    return NextResponse.json(
      {
        error: "invalid GitHub webhook signature",
        message: "GitHub webhook signature validation failed."
      },
      { status: 401 }
    );
  }

  await store.writeAuditLog("webhook_signature_validated", "github_delivery", deliveryId);

  if (await store.hasWebhookDelivery(deliveryId)) {
    return NextResponse.json({ status: "duplicate_ignored" });
  }

  await store.writeAuditLog("webhook_received", "github_delivery", deliveryId);

  if (event !== "push" && event !== "pull_request") {
    return NextResponse.json(
      {
        status: "ignored",
        message: `Unsupported GitHub webhook event: ${event || "unknown"}`
      },
      { status: 202 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await store.writeAuditLog("webhook_rejected", "github_delivery", deliveryId);
    return NextResponse.json(
      {
        error: "invalid webhook payload",
        message: "GitHub webhook payload must be valid JSON."
      },
      { status: 400 }
    );
  }

  const normalizedEvent = normalizeSupportedEvent(event, payload);
  if (!normalizedEvent) {
    await store.writeAuditLog("webhook_rejected", "github_delivery", deliveryId);
    return NextResponse.json(
      {
        error: "invalid webhook payload",
        message: "GitHub webhook payload is missing required repository or commit metadata."
      },
      { status: 400 }
    );
  }

  const repository = await store.findGitHubRepository(normalizedEvent.owner, normalizedEvent.name);
  if (!repository) {
    await store.writeAuditLog("webhook_rejected", "repository", `${normalizedEvent.owner}/${normalizedEvent.name}`);
    return NextResponse.json(
      {
        error: "repository not connected",
        message: "Connect this GitHub repository in AutoCyber before enabling webhook monitoring."
      },
      { status: 404 }
    );
  }

  const scanJob = await enqueueScanJob(store, {
    repositoryId: repository.id,
    source: event,
    branch: normalizedEvent.branch,
    commitSha: normalizedEvent.commitSha,
    webhookDeliveryId: deliveryId,
    pullRequestNumber: normalizedEvent.pullRequestNumber
  });

  if (process.env.AUTOCYBER_WEBHOOK_EXECUTION_MODE === "inline") {
    const result = await processScanJob(store, scanJob.id);
    return NextResponse.json(
      {
        status: result.status,
        scanJob: {
          id: scanJob.id,
          status: result.status === "completed" ? "completed" : "failed",
          source: scanJob.source,
          branch: scanJob.branch,
          commitSha: scanJob.commitSha,
          pullRequestNumber: scanJob.pullRequestNumber
        },
        findings: result.status === "completed" ? result.findings : 0,
        error: result.status === "failed" ? result.error : undefined
      },
      { status: result.status === "completed" ? 200 : 500 }
    );
  }

  return NextResponse.json(
    {
      status: "queued",
      scanJob: {
        id: scanJob.id,
        status: scanJob.status,
        source: scanJob.source,
        branch: scanJob.branch,
        commitSha: scanJob.commitSha,
        pullRequestNumber: scanJob.pullRequestNumber
      }
    },
    { status: 202 }
  );
}

function isValidGitHubSignature(rawBody: string, signature: string, secret: string): boolean {
  const prefix = "sha256=";
  if (!signature.startsWith(prefix)) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.slice(prefix.length);
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function normalizeSupportedEvent(
  event: SupportedGitHubEvent,
  payload: unknown
): { owner: string; name: string; branch: string; commitSha: string; pullRequestNumber: number | null } | null {
  if (!isRecord(payload)) return null;
  const repository = normalizeRepository(payload.repository);
  if (!repository) return null;

  if (event === "push") {
    const pushPayload = payload as GitHubPushPayload;
    const branch = typeof pushPayload.ref === "string" ? pushPayload.ref.replace(/^refs\/heads\//, "") : repository.defaultBranch;
    const commitSha = pushPayload.head_commit?.id ?? pushPayload.after;
    if (!branch || !commitSha) return null;
    return {
      owner: repository.owner,
      name: repository.name,
      branch,
      commitSha,
      pullRequestNumber: null
    };
  }

  const pullRequestPayload = payload as GitHubPullRequestPayload;
  const branch = pullRequestPayload.pull_request?.head?.ref;
  const commitSha = pullRequestPayload.pull_request?.head?.sha;
  const pullRequestNumber = pullRequestPayload.number ?? pullRequestPayload.pull_request?.number ?? null;
  if (!branch || !commitSha) return null;

  return {
    owner: repository.owner,
    name: repository.name,
    branch,
    commitSha,
    pullRequestNumber
  };
}

function normalizeRepository(input: unknown): { owner: string; name: string; defaultBranch: string } | null {
  if (!isRecord(input)) return null;
  const repository = input as GitHubRepositoryPayload;
  const owner = repository.owner?.login ?? repository.full_name?.split("/")[0];
  const name = repository.name ?? repository.full_name?.split("/")[1];
  if (!owner || !name) return null;
  return {
    owner,
    name,
    defaultBranch: repository.default_branch ?? "main"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
