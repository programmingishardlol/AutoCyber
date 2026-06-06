import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("scan API route", () => {
  it("rejects invalid GitHub URL scans with a safe error", async () => {
    const response = await POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        body: JSON.stringify({
          source: "github",
          repoUrl: "https://gitlab.com/example/app",
        }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid repo input");
    expect(body.message).toContain("public GitHub repository URL");
  });

  it("scans public GitHub URL input through the local scanner after clone ingestion", async () => {
    const clonedRepo = await mkdtemp(
      join(tmpdir(), "autocyber-api-github-scan-"),
    );
    await writeFile(
      join(clonedRepo, "package.json"),
      JSON.stringify({ dependencies: { next: "latest" } }),
    );
    await writeFile(
      join(clonedRepo, ".env"),
      envLine("OPENAI_API_KEY", fakeOpenAiKey("stage5dtest")),
    );

    vi.stubEnv("AUTOCYBER_TEST_GITHUB_CLONE_PATH", clonedRepo);
    const response = await POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        body: JSON.stringify({
          source: "github",
          repoUrl: "https://github.com/example/public-app",
        }),
      }),
    );
    vi.unstubAllEnvs();

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scanJob.status).toBe("completed");
    expect(body.scanJob.source).toBe("github");
    expect(body.repository.provider).toBe("github");
    expect(body.repository.connectionType).toBe("public_github");
    expect(body.repository.canScan).toBe(true);
    expect(body.repository.canOpenPr).toBe(false);
    expect(
      body.findings.some(
        (finding: { ruleId: string }) => finding.ruleId === "exposed-secret",
      ),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain(
      "stage5dtest000000000000000000000000000000",
    );
  });

  it("rejects invalid local paths without exposing stack traces", async () => {
    const response = await POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        body: JSON.stringify({
          source: "local",
          path: "/etc",
        }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("path not allowed");
    expect(JSON.stringify(body)).not.toContain("Error:");
  });
});

function envLine(name: string, value: string): string {
  return `${name}=${value}`;
}

function fakeOpenAiKey(label: string): string {
  return ["sk", "proj", `${label}000000000000000000000000000000`].join("-");
}
