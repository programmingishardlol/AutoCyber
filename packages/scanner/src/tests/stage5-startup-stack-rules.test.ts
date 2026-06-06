import { describe, expect, it } from "vitest";
import { basename, dirname, join } from "node:path";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createLocalScanner } from "../index";

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);
const vulnerableStartupStackEnv = [
  envLine(
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "stage5service000000000000000000000000",
  ),
  envLine("STRIPE_SECRET_KEY", fakeStripeLiveKey("stage5stripe")),
  envLine("OPENAI_API_KEY", fakeOpenAiKey("stage5openai")),
].join("\n");

describe("Stage 5A startup-stack scanner rules", () => {
  it("detects startup-stack risks across Supabase, Vercel, Clerk, Stripe, OpenAI, and Anthropic", async () => {
    const repositoryPath = await createFixtureCopy(
      "stage5-startup-stack-vulnerable",
      { ".env": vulnerableStartupStackEnv },
    );

    const result = await createLocalScanner().scan({
      repositoryPath,
      repositoryId: "repo_stage5",
      scanJobId: "scan_stage5",
    });

    const ruleIds = result.findings.map((finding) => finding.ruleId).sort();

    expect(result.projectProfile.integrations).toEqual([
      "anthropic",
      "clerk",
      "openai",
      "stripe",
      "supabase",
    ]);
    expect(result.projectProfile.deploymentProviders).toContain("vercel");
    expect(ruleIds).toEqual(
      expect.arrayContaining([
        "supabase-exposed-service-role-key",
        "supabase-service-role-in-client",
        "supabase-permissive-rls-policy",
        "supabase-missing-rls",
        "unsafe-cors-wildcard",
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
      ]),
    );

    const clerkOrgFinding = result.findings.find(
      (finding) => finding.ruleId === "clerk-missing-org-authorization",
    );
    expect(clerkOrgFinding?.severity).toBe("medium");
    expect(clerkOrgFinding?.confidence).toBeLessThanOrEqual(0.7);
    expect(
      result.findings.find(
        (finding) =>
          finding.ruleId === "stripe-webhook-missing-construct-event",
      )?.evidence[0]?.snippet,
    ).toContain(".json()");
    expect(
      result.findings.find(
        (finding) => finding.ruleId === "ai-unsafe-prompt-logging",
      )?.evidence.length,
    ).toBeGreaterThanOrEqual(1);

    for (const ruleId of ruleIds) {
      const finding = result.findings.find((item) => item.ruleId === ruleId);
      expect(finding?.evidence.length).toBeGreaterThan(0);
      expect(finding?.riskExplanation.length).toBeGreaterThan(20);
      expect(finding?.remediationSummary.length).toBeGreaterThan(20);
      expect(finding?.verificationStrategy.length).toBeGreaterThan(20);
    }

    expect(JSON.stringify(result.findings)).toContain("[REDACTED]");
    expect(JSON.stringify(result.findings)).not.toContain("stage5service");
    expect(JSON.stringify(result.findings)).not.toContain("stage5stripe");
    expect(JSON.stringify(result.findings)).not.toContain("stage5openai");
    expect(JSON.stringify(result.findings)).not.toContain("yAUUYGZG69J");
    expect(JSON.stringify(result.findings)).not.toContain("JKL798");
  });

  it("does not report Stage 5A startup-stack risks against safe examples", async () => {
    const result = await createLocalScanner().scan({
      repositoryPath: join(fixturesRoot, "stage5-startup-stack-secure"),
      repositoryId: "repo_stage5_safe",
      scanJobId: "scan_stage5_safe",
    });

    const stage5RuleIds = new Set([
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

    expect(
      result.findings.filter((finding) => stage5RuleIds.has(finding.ruleId)),
    ).toEqual([]);
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

function fakeStripeLiveKey(label: string): string {
  return ["sk", "live", `${label}000000000000000000000000`].join("_");
}

function fakeOpenAiKey(label: string): string {
  return ["sk", "proj", `${label}000000000000000000000000`].join("-");
}
