import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGitHubWebhook } from "../../../../lib/github-webhook-handler";
import { getPersistenceStore } from "../../../../lib/persistence/store";
import { POST } from "./route";

const webhookSecret = "stage6-webhook-secret";

describe("GitHub webhook API route", () => {
  beforeEach(() => {
    process.env.AUTOCYBER_PERSISTENCE = "dev";
    process.env.GITHUB_WEBHOOK_SECRET = webhookSecret;
    globalThis.__autocyberPersistenceStore = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AUTOCYBER_PERSISTENCE;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.AUTOCYBER_TEST_GITHUB_CLONE_PATH;
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("accepts a valid push signature and processes a monitoring scan by default", async () => {
    await seedGitHubRepository();
    const payload = pushPayload({
      deliverySuffix: "push-valid",
      sha: "abc123push",
    });

    const response = await handleGitHubWebhook(
      signedRequest(payload, {
        event: "push",
        delivery: "delivery-push-valid",
      }),
      {
        processScanJob: async (store, scanJobId) => {
          const scanJob = await store.getScanJob(scanJobId);
          await store.markScanJobRunning(scanJobId);
          await store.saveFindings([stubFinding(scanJob!.repositoryId, scanJobId)]);
          await store.upsertRepoProfileMemory(scanJob!.repositoryId, stubProjectProfile());
          await store.completeScanJob(scanJobId, { critical: 0, high: 1, medium: 0, low: 0, info: 0 });
          await store.writeAuditLog("monitoring_scan_completed", "scan_job", scanJobId);
          await store.createNotification({
            repositoryId: scanJob!.repositoryId,
            scanJobId,
            findingId: null,
            type: "webhook_scan_completed",
            severity: "info",
            title: "Webhook scan completed",
            message: "AutoCyber completed a push-triggered scan."
          });
          return { status: "completed", scanJobId, findings: 1 };
        }
      },
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed");
    expect(body.scanJob.source).toBe("push");
    expect(body.scanJob.commitSha).toBe("abc123push");
    expect(body.findings).toBeGreaterThan(0);
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "completed",
      source: "push",
      branch: "main",
      commitSha: "abc123push",
      webhookDeliveryId: "delivery-push-valid",
      pullRequestNumber: null,
    });
    expect(snapshot.findings.length).toBeGreaterThan(0);
    expect(snapshot.notifications.map((notification) => notification.type)).toContain("webhook_scan_completed");
    expect(snapshot.securityMemories.length).toBeGreaterThan(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "webhook_signature_validated",
        "webhook_received",
        "scan_queued",
        "scan_running",
        "monitoring_scan_completed",
      ]),
    );
    expect(JSON.stringify(body)).not.toContain(webhookSecret);
  });

  it("preserves queue-only push behavior when explicitly configured", async () => {
    vi.stubEnv("AUTOCYBER_WEBHOOK_EXECUTION_MODE", "queued");
    await seedGitHubRepository();
    const payload = pushPayload({
      deliverySuffix: "push-queued",
      sha: "abc123queued",
    });

    const response = await POST(
      signedRequest(payload, {
        event: "push",
        delivery: "delivery-push-queued",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(202);
    expect(body.status).toBe("queued");
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "queued",
      source: "push",
      commitSha: "abc123queued",
      webhookDeliveryId: "delivery-push-queued",
    });
    expect(snapshot.findings).toHaveLength(0);
    expect(snapshot.notifications).toHaveLength(0);
  });

  it("accepts a valid pull_request signature and stores PR scan metadata", async () => {
    await seedGitHubRepository();
    const payload = pullRequestPayload({
      number: 42,
      sha: "abc123pr",
      branch: "feature/security",
    });

    const response = await POST(
      signedRequest(payload, {
        event: "pull_request",
        delivery: "delivery-pr-valid",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(202);
    expect(body.scanJob.source).toBe("pull_request");
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "queued",
      source: "pull_request",
      branch: "feature/security",
      commitSha: "abc123pr",
      webhookDeliveryId: "delivery-pr-valid",
      pullRequestNumber: 42,
    });
  });

  it("maps webhooks for multiple repos under one installation to the correct repository rows", async () => {
    const repoA = await seedInstalledGitHubRepository("repo-a");
    const repoB = await seedInstalledGitHubRepository("repo-b");

    const responseA = await handleGitHubWebhook(
      signedRequest(pushPayload({ deliverySuffix: "repo-a", sha: "sha-a", owner: "acme", name: "repo-a" }), {
        event: "push",
        delivery: "delivery-repo-a",
      }),
      {
        processScanJob: async (store, scanJobId) => {
          await store.markScanJobRunning(scanJobId);
          await store.completeScanJob(scanJobId, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
          return { status: "completed", scanJobId, findings: 0 };
        }
      },
    );
    const responseB = await POST(
      signedRequest(pullRequestPayload({ number: 7, sha: "sha-b", branch: "feature/b", owner: "acme", name: "repo-b" }), {
        event: "pull_request",
        delivery: "delivery-repo-b",
      }),
    );
    const unknownResponse = await POST(
      signedRequest(pushPayload({ deliverySuffix: "repo-c", sha: "sha-c", owner: "acme", name: "repo-c" }), {
        event: "push",
        delivery: "delivery-repo-c",
      }),
    );
    const snapshot = getPersistenceStore().snapshot();

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(202);
    expect(unknownResponse.status).toBe(404);
    expect(snapshot.scanJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repositoryId: repoA.id,
          source: "push",
          status: "completed",
          commitSha: "sha-a",
          webhookDeliveryId: "delivery-repo-a",
        }),
        expect.objectContaining({
          repositoryId: repoB.id,
          source: "pull_request",
          status: "queued",
          commitSha: "sha-b",
          pullRequestNumber: 7,
          webhookDeliveryId: "delivery-repo-b",
        }),
      ]),
    );
  });

  it("stores private repository webhook scans with installation mapping metadata", async () => {
    await seedPrivateGitHubRepository();
    const payload = pullRequestPayload({
      number: 84,
      sha: "privatepr123",
      branch: "feature/private-monitoring",
    });

    const response = await POST(
      signedRequest(payload, {
        event: "pull_request",
        delivery: "delivery-private-pr",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(202);
    expect(body.scanJob.source).toBe("pull_request");
    expect(snapshot.repositories[0]).toMatchObject({
      provider: "github",
      installationId: "123456",
      isPrivate: true,
    });
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "queued",
      source: "pull_request",
      branch: "feature/private-monitoring",
      commitSha: "privatepr123",
      webhookDeliveryId: "delivery-private-pr",
      pullRequestNumber: 84,
    });
  });

  it("processes private repository push webhooks without exposing installation secrets", async () => {
    await seedPrivateGitHubRepository();
    const payload = pushPayload({
      deliverySuffix: "private-push",
      sha: "privatepush123",
    });

    const response = await handleGitHubWebhook(
      signedRequest(payload, {
        event: "push",
        delivery: "delivery-private-push",
      }),
      {
        processScanJob: async (store, scanJobId) => {
          const scanJob = await store.getScanJob(scanJobId);
          await store.markScanJobRunning(scanJobId);
          await store.completeScanJob(scanJobId, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
          await store.createNotification({
            repositoryId: scanJob!.repositoryId,
            scanJobId,
            findingId: null,
            type: "webhook_scan_completed",
            severity: "info",
            title: "Webhook scan completed",
            message: "AutoCyber completed a push-triggered scan."
          });
          return { status: "completed", scanJobId, findings: 0 };
        }
      },
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(200);
    expect(body.scanJob.source).toBe("push");
    expect(body.status).toBe("completed");
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "completed",
      source: "push",
      branch: "main",
      commitSha: "privatepush123",
      webhookDeliveryId: "delivery-private-push",
      pullRequestNumber: null,
    });
    expect(snapshot.notifications.map((notification) => notification.type)).toContain("webhook_scan_completed");
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(JSON.stringify(snapshot.auditLogs)).not.toContain("123456");
  });

  it("rejects invalid signatures before processing payloads", async () => {
    const payload = pushPayload({ deliverySuffix: "bad-signature" });

    const response = await POST(
      requestWithHeaders(JSON.stringify(payload), {
        "x-github-event": "push",
        "x-github-delivery": "delivery-bad-signature",
        "x-hub-signature-256": "sha256=bad",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(401);
    expect(body.error).toBe("invalid GitHub webhook signature");
    expect(snapshot.scanJobs).toHaveLength(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "webhook_rejected",
    );
    expect(JSON.stringify(body)).not.toContain("bad");
  });

  it("does not parse malformed payloads before signature validation", async () => {
    const response = await POST(
      requestWithHeaders("{not-json", {
        "x-github-event": "push",
        "x-github-delivery": "delivery-malformed-bad-signature",
        "x-hub-signature-256": "sha256=bad",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(401);
    expect(body.error).toBe("invalid GitHub webhook signature");
    expect(snapshot.scanJobs).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("SyntaxError");
    expect(JSON.stringify(body)).not.toContain(webhookSecret);
  });

  it("rejects missing signatures before processing payloads", async () => {
    const payload = pushPayload({ deliverySuffix: "missing-signature" });

    const response = await POST(
      requestWithHeaders(JSON.stringify(payload), {
        "x-github-event": "push",
        "x-github-delivery": "delivery-missing-signature",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(401);
    expect(body.error).toBe("missing GitHub webhook signature");
    expect(snapshot.scanJobs).toHaveLength(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "webhook_rejected",
    );
  });

  it("returns a safe error for invalid JSON after signature validation", async () => {
    const rawBody = "{not-json";
    const response = await POST(
      requestWithHeaders(rawBody, {
        "x-github-event": "push",
        "x-github-delivery": "delivery-invalid-json",
        "x-hub-signature-256": signBody(rawBody),
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid webhook payload");
    expect(snapshot.scanJobs).toHaveLength(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "webhook_rejected",
    );
    expect(JSON.stringify(body)).not.toContain("SyntaxError");
    expect(JSON.stringify(body)).not.toContain(webhookSecret);
  });

  it("ignores unsupported events safely after signature validation", async () => {
    const payload = { action: "opened", repository: repositoryPayload() };

    const response = await POST(
      signedRequest(payload, {
        event: "issues",
        delivery: "delivery-unsupported",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(202);
    expect(body.status).toBe("ignored");
    expect(body.message).toContain("Unsupported GitHub webhook event");
    expect(snapshot.scanJobs).toHaveLength(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "webhook_signature_validated",
        "webhook_received",
      ]),
    );
  });

  it("returns a safe response when the GitHub repository is not connected", async () => {
    const payload = pushPayload({ deliverySuffix: "unknown-repo" });

    const response = await POST(
      signedRequest(payload, {
        event: "push",
        delivery: "delivery-unknown-repo",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(404);
    expect(body.error).toBe("repository not connected");
    expect(snapshot.repositories).toHaveLength(0);
    expect(snapshot.scanJobs).toHaveLength(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toContain(
      "webhook_rejected",
    );
    expect(JSON.stringify(body)).not.toContain(webhookSecret);
  });

  it("handles duplicate deliveries without creating another scan job", async () => {
    await seedGitHubRepository();
    const payload = pushPayload({
      deliverySuffix: "duplicate",
      sha: "abc123duplicate",
    });
    const request = signedRequest(payload, {
      event: "push",
      delivery: "delivery-duplicate",
    });

    const firstResponse = await handleGitHubWebhook(request, {
      processScanJob: async (store, scanJobId) => {
        await store.markScanJobRunning(scanJobId);
        await store.completeScanJob(scanJobId, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
        return { status: "completed", scanJobId, findings: 0 };
      }
    });
    const secondResponse = await POST(
      signedRequest(payload, { event: "push", delivery: "delivery-duplicate" }),
    );
    const secondBody = await secondResponse.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondBody.status).toBe("duplicate_ignored");
    expect(snapshot.scanJobs).toHaveLength(1);
    expect(snapshot.auditLogs.map((log) => log.action)).toContain("webhook_duplicate_ignored");
  });
});

async function seedGitHubRepository() {
  return getPersistenceStore().upsertRepository({
    projectId: "proj_dev",
    provider: "github",
    owner: "programmingishardlol",
    name: "autocyber-stage4-test",
    defaultBranch: "main",
    url: "https://github.com/programmingishardlol/autocyber-stage4-test",
  });
}

async function seedPrivateGitHubRepository() {
  return getPersistenceStore().upsertRepository({
    projectId: "proj_dev",
    provider: "github",
    owner: "programmingishardlol",
    name: "autocyber-stage4-test",
    defaultBranch: "main",
    url: "https://github.com/programmingishardlol/autocyber-stage4-test",
    installationId: "123456",
    isPrivate: true,
  });
}

async function seedInstalledGitHubRepository(name: string) {
  return getPersistenceStore().upsertRepository({
    projectId: "proj_dev",
    provider: "github",
    owner: "acme",
    name,
    defaultBranch: "main",
    url: `https://github.com/acme/${name}`,
    installationId: "123456",
    isPrivate: true,
    connectionType: "github_app",
    canScan: true,
    canMonitor: true,
    canOpenPr: false,
    permissionsSummary: {
      contents: "read",
      pullRequests: "read",
      githubAppPrCreationImplemented: false,
    },
  });
}

function signedRequest(
  payload: unknown,
  input: { event: string; delivery: string },
): Request {
  const rawBody = JSON.stringify(payload);
  return requestWithHeaders(rawBody, {
    "x-github-event": input.event,
    "x-github-delivery": input.delivery,
    "x-hub-signature-256": signBody(rawBody),
  });
}

function requestWithHeaders(
  rawBody: string,
  headers: Record<string, string>,
): Request {
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function signBody(rawBody: string): string {
  return `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
}

function pushPayload(input: { deliverySuffix: string; sha?: string; owner?: string; name?: string }) {
  const sha = input.sha ?? `sha-${input.deliverySuffix}`;
  return {
    ref: "refs/heads/main",
    after: sha,
    head_commit: { id: sha },
    repository: repositoryPayload(input),
  };
}

function pullRequestPayload(input: {
  number: number;
  sha: string;
  branch: string;
  owner?: string;
  name?: string;
}) {
  return {
    action: "opened",
    number: input.number,
    pull_request: {
      number: input.number,
      head: {
        ref: input.branch,
        sha: input.sha,
      },
    },
    repository: repositoryPayload(input),
  };
}

function repositoryPayload(input: { owner?: string; name?: string } = {}) {
  const owner = input.owner ?? "programmingishardlol";
  const name = input.name ?? "autocyber-stage4-test";
  return {
    name,
    full_name: `${owner}/${name}`,
    clone_url:
      `https://github.com/${owner}/${name}.git`,
    html_url: `https://github.com/${owner}/${name}`,
    default_branch: "main",
    owner: {
      login: owner,
    },
  };
}

function stubProjectProfile() {
  return {
    frameworks: ["nextjs"],
    languages: ["typescript"],
    integrations: [],
    deploymentProviders: [],
    packageManagers: ["pnpm"],
  };
}

function stubFinding(repositoryId: string, scanJobId: string) {
  return {
    id: `${scanJobId}:local:missing-api-auth:test`,
    repositoryId,
    scanJobId,
    ruleId: "missing-api-auth" as const,
    title: "API route does not enforce authentication",
    category: "missing-auth",
    severity: "high" as const,
    confidence: 0.84,
    status: "open" as const,
    stackTags: ["nextjs" as const],
    affectedFile: "app/api/users/route.ts",
    evidence: [
      {
        filePath: "app/api/users/route.ts",
        startLine: 1,
        endLine: 1,
        snippet: "export async function GET() {}",
      },
    ],
    riskExplanation: "Sensitive API routes need server-side user checks.",
    remediationSummary: "Require server-side authentication.",
    verificationStrategy: "Rerun scanner.",
    autofixAvailable: true,
  };
}
