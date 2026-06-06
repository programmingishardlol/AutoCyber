import { describe, expect, it } from "vitest";
import { basename, dirname, join } from "node:path";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createLocalScanner } from "../index";

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);
const insecureStartupEnv = [
  envLine("OPENAI_API_KEY", fakeOpenAiKey("autocyberfixture")),
  envLine(
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "autocyberfixture",
      "service_role",
    ].join("."),
  ),
].join("\n");

describe("local repository scanner", () => {
  it("normalizes initial Stage 1 findings without executing repository code", async () => {
    const scanner = createLocalScanner();
    const repositoryPath = await createFixtureCopy("insecure-startup-app", {
      ".env": insecureStartupEnv,
    });

    const result = await scanner.scan({
      repositoryPath,
      repositoryId: "repo_fixture",
      scanJobId: "scan_fixture",
    });

    expect(result.scanner).toBe("local");
    expect(result.filesScanned).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
    expect(result.projectProfile).toEqual({
      frameworks: ["nextjs"],
      languages: ["typescript"],
      integrations: ["anthropic", "clerk", "openai", "stripe", "supabase"],
      deploymentProviders: ["vercel"],
      packageManagers: ["npm"],
    });
    expect(result.rulesRun).toEqual([
      "exposed-secret",
      "missing-env-example",
      "unsafe-cors-wildcard",
      "missing-api-auth",
      "missing-authorization",
      "missing-security-headers",
      "dangerous-public-env",
      "insecure-webhook-handler",
      "dependency-risk-placeholder",
      "unsafe-supabase-usage",
      "unsafe-stripe-payment-state",
      "unsafe-ai-api-usage",
      "supabase-exposed-service-role-key",
      "supabase-service-role-in-client",
      "supabase-permissive-rls-policy",
      "supabase-missing-rls",
      "next-public-sensitive-env",
      "next-client-secret-reference",
      "vercel-risky-config",
      "clerk-api-missing-auth",
      "clerk-missing-org-authorization",
      "clerk-middleware-gap",
      "stripe-webhook-missing-construct-event",
      "stripe-client-trusted-payment-state",
      "stripe-exposed-secret-key",
      "ai-route-missing-rate-limit",
      "ai-unsafe-prompt-logging",
      "ai-client-side-key-usage",
    ]);

    const ruleIds = result.findings.map((finding) => finding.ruleId).sort();
    expect(ruleIds).toEqual([
      "ai-route-missing-rate-limit",
      "ai-unsafe-prompt-logging",
      "dangerous-public-env",
      "dependency-risk-placeholder",
      "exposed-secret",
      "insecure-webhook-handler",
      "missing-api-auth",
      "missing-authorization",
      "missing-env-example",
      "missing-security-headers",
      "next-public-sensitive-env",
      "stripe-client-trusted-payment-state",
      "stripe-webhook-missing-construct-event",
      "supabase-exposed-service-role-key",
      "supabase-service-role-in-client",
      "unsafe-ai-api-usage",
      "unsafe-cors-wildcard",
      "unsafe-stripe-payment-state",
      "unsafe-supabase-usage",
    ]);

    for (const finding of result.findings) {
      expect(finding.id).toMatch(/^scan_fixture:/);
      expect(finding.repositoryId).toBe("repo_fixture");
      expect(finding.scanJobId).toBe("scan_fixture");
      expect(finding.status).toBe("open");
      expect(finding.confidence).toBeGreaterThan(0);
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.riskExplanation.length).toBeGreaterThan(20);
      expect(finding.remediationSummary.length).toBeGreaterThan(20);
      expect(finding.verificationStrategy.length).toBeGreaterThan(20);
    }

    const exposedSecret = result.findings.find(
      (finding) => finding.ruleId === "exposed-secret",
    );
    expect(exposedSecret?.evidence[0]?.snippet).toContain("[REDACTED]");
    expect(exposedSecret?.evidence[0]?.snippet).not.toContain(
      "autocyberfixture000000000000000000000000",
    );
  });

  it("does not report the initial checks against the secure fixture", async () => {
    const scanner = createLocalScanner();

    const result = await scanner.scan({
      repositoryPath: join(fixturesRoot, "secure-startup-app"),
    });

    expect(result.errors).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.projectProfile.frameworks).toContain("nextjs");
    expect(result.projectProfile.integrations).toEqual([
      "anthropic",
      "clerk",
      "openai",
      "stripe",
      "supabase",
    ]);
  });

  it("ignores generated folders even when they contain bait findings", async () => {
    const scanner = createLocalScanner();
    const repositoryPath = await mkdtemp(
      join(tmpdir(), "autocyber-generated-folders-"),
    );
    const generatedDirectories = [
      "node_modules",
      ".git",
      ".next",
      "dist",
      "build",
      "coverage",
      ".turbo",
    ];

    await writeFile(
      join(repositoryPath, "package.json"),
      JSON.stringify({
        name: "generated-folder-regression",
        private: true,
        dependencies: { next: "^15.0.0" },
      }),
    );
    await writeFile(
      join(repositoryPath, ".env"),
      `${envLine("OPENAI_API_KEY", fakeOpenAiKey("realfixture"))}\n`,
    );
    await mkdir(join(repositoryPath, "app/api/admin/users"), {
      recursive: true,
    });
    await writeFile(
      join(repositoryPath, "app/api/admin/users/route.ts"),
      "import { NextResponse } from 'next/server';\nexport async function GET() {\n return NextResponse.json({ users: [] });\n}\n",
    );

    for (const directory of generatedDirectories) {
      await mkdir(join(repositoryPath, directory), { recursive: true });
      await writeFile(
        join(repositoryPath, directory, "generated.ts"),
        "NEXT_PUBLIC_GENERATED_SECRET=generated_folder_bait_should_not_be_scanned_000000000000\n",
      );
    }

    const result = await scanner.scan({ repositoryPath });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      result.findings.some((finding) => finding.ruleId === "exposed-secret"),
    ).toBe(true);
    expect(
      result.findings.some((finding) => finding.ruleId === "missing-api-auth"),
    ).toBe(true);

    const generatedFinding = result.findings.find((finding) =>
      generatedDirectories.some(
        (directory) =>
          finding.affectedFile === directory ||
          finding.affectedFile.startsWith(`${directory}/`),
      ),
    );
    expect(generatedFinding).toBeUndefined();
    expect(JSON.stringify(result.findings)).not.toContain(
      "generated_folder_bait_should_not_be_scanned",
    );
  });
});

async function createFixtureCopy(
  name: string,
  generatedFiles: Record<string, string>,
): Promise<string> {
  const repositoryPath = await mkdtemp(join(tmpdir(), `autocyber-${name}-`));
  await cp(join(fixturesRoot, name), repositoryPath, {
    recursive: true,
    filter: (source) => basename(source) !== ".env",
  });

  for (const [relativePath, content] of Object.entries(generatedFiles)) {
    await writeFile(join(repositoryPath, relativePath), `${content}\n`);
  }

  return repositoryPath;
}

function envLine(name: string, value: string): string {
  return `${name}=${value}`;
}

function fakeOpenAiKey(label: string): string {
  return ["sk", "proj", `${label}000000000000000000000000`].join("-");
}
