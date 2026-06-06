import { createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("accepts a valid push signature and creates a queued monitoring scan", async () => {
    await seedGitHubRepository();
    const payload = pushPayload({
      deliverySuffix: "push-valid",
      sha: "abc123push",
    });

    const response = await POST(
      signedRequest(payload, {
        event: "push",
        delivery: "delivery-push-valid",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(202);
    expect(body.status).toBe("queued");
    expect(body.scanJob.source).toBe("push");
    expect(body.scanJob.commitSha).toBe("abc123push");
    expect(body.findings).toBeUndefined();
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "queued",
      source: "push",
      branch: "main",
      commitSha: "abc123push",
      webhookDeliveryId: "delivery-push-valid",
      pullRequestNumber: null,
    });
    expect(snapshot.findings).toHaveLength(0);
    expect(snapshot.securityMemories).toHaveLength(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "webhook_signature_validated",
        "webhook_received",
        "scan_queued",
      ]),
    );
    expect(JSON.stringify(body)).not.toContain(webhookSecret);
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

  it("queues private repository push webhooks without exposing installation secrets", async () => {
    await seedPrivateGitHubRepository();
    const payload = pushPayload({
      deliverySuffix: "private-push",
      sha: "privatepush123",
    });

    const response = await POST(
      signedRequest(payload, {
        event: "push",
        delivery: "delivery-private-push",
      }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(202);
    expect(body.scanJob.source).toBe("push");
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "queued",
      source: "push",
      branch: "main",
      commitSha: "privatepush123",
      webhookDeliveryId: "delivery-private-push",
      pullRequestNumber: null,
    });
    expect(JSON.stringify(body)).not.toContain("123456");
    expect(JSON.stringify(snapshot.auditLogs)).not.toContain("123456");
  });

  it("can run inline only when explicitly configured for local development", async () => {
    const clonedRepo = await createVulnerableClone();
    vi.stubEnv("AUTOCYBER_TEST_GITHUB_CLONE_PATH", clonedRepo);
    vi.stubEnv("AUTOCYBER_WEBHOOK_EXECUTION_MODE", "inline");
    await seedGitHubRepository();
    const payload = pushPayload({
      deliverySuffix: "inline",
      sha: "abc123inline",
    });

    const response = await POST(
      signedRequest(payload, { event: "push", delivery: "delivery-inline" }),
    );
    const body = await response.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed");
    expect(body.findings).toBeGreaterThan(0);
    expect(snapshot.scanJobs.at(-1)).toMatchObject({
      status: "completed",
      source: "push",
      commitSha: "abc123inline",
      webhookDeliveryId: "delivery-inline",
    });
    expect(snapshot.findings.length).toBeGreaterThan(0);
    expect(snapshot.auditLogs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "scan_queued",
        "scan_running",
        "monitoring_scan_started",
        "monitoring_scan_completed",
      ]),
    );
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
    const clonedRepo = await createVulnerableClone();
    vi.stubEnv("AUTOCYBER_TEST_GITHUB_CLONE_PATH", clonedRepo);
    await seedGitHubRepository();
    const payload = pushPayload({
      deliverySuffix: "duplicate",
      sha: "abc123duplicate",
    });
    const request = signedRequest(payload, {
      event: "push",
      delivery: "delivery-duplicate",
    });

    const firstResponse = await POST(request);
    const secondResponse = await POST(
      signedRequest(payload, { event: "push", delivery: "delivery-duplicate" }),
    );
    const secondBody = await secondResponse.json();
    const snapshot = getPersistenceStore().snapshot();

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(200);
    expect(secondBody.status).toBe("duplicate_ignored");
    expect(snapshot.scanJobs).toHaveLength(1);
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

async function createVulnerableClone(): Promise<string> {
  const clonedRepo = await mkdtemp(join(tmpdir(), "autocyber-webhook-clone-"));
  await writeFile(
    join(clonedRepo, "package.json"),
    JSON.stringify({ dependencies: { next: "latest" } }),
  );
  await writeFile(
    join(clonedRepo, ".env"),
    envLine("OPENAI_API_KEY", fakeOpenAiKey("webhooktest")),
  );
  return clonedRepo;
}

function envLine(name: string, value: string): string {
  return `${name}=${value}`;
}

function fakeOpenAiKey(label: string): string {
  return ["sk", "proj", `${label}000000000000000000000000000000`].join("-");
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

function pushPayload(input: { deliverySuffix: string; sha?: string }) {
  const sha = input.sha ?? `sha-${input.deliverySuffix}`;
  return {
    ref: "refs/heads/main",
    after: sha,
    head_commit: { id: sha },
    repository: repositoryPayload(),
  };
}

function pullRequestPayload(input: {
  number: number;
  sha: string;
  branch: string;
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
    repository: repositoryPayload(),
  };
}

function repositoryPayload() {
  return {
    name: "autocyber-stage4-test",
    full_name: "programmingishardlol/autocyber-stage4-test",
    clone_url:
      "https://github.com/programmingishardlol/autocyber-stage4-test.git",
    html_url: "https://github.com/programmingishardlol/autocyber-stage4-test",
    default_branch: "main",
    owner: {
      login: "programmingishardlol",
    },
  };
}
