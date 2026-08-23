import { beforeEach, describe, expect, it } from "vitest";
import { getPersistenceStore } from "../../../../lib/persistence/store";
import { POST } from "./route";

describe("false positive finding API route", () => {
  beforeEach(() => {
    globalThis.__autocyberPersistenceStore = undefined;
  });

  it("marks a finding fingerprint false positive without deleting the finding", async () => {
    const store = getPersistenceStore();
    await store.saveFindings([
      {
        id: "finding_fp",
        repositoryId: "repo_demo",
        scanJobId: "scan_demo",
        ruleId: "missing-api-auth",
        title: "API route missing authentication",
        category: "access-control",
        severity: "high",
        confidence: 0.9,
        status: "open",
        stackTags: ["nextjs"],
        affectedFile: "app/api/admin/users/route.ts",
        evidence: [
          {
            filePath: "app/api/admin/users/route.ts",
            startLine: 1,
            endLine: 1,
            snippet: "export async function GET() {}",
          },
        ],
        riskExplanation: "The route does not check authentication.",
        remediationSummary: "Require authentication.",
        verificationStrategy: "Rerun scanner.",
        autofixAvailable: true,
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/findings/false-positive", {
        method: "POST",
        body: JSON.stringify({
          findingId: "finding_fp",
          note: "Public admin test route is intentionally exposed in this fixture.",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.finding).toMatchObject({
      id: "finding_fp",
      status: "false_positive",
      memoryStatus: "false_positive_suppressed",
    });
    expect(store.snapshot().findings).toHaveLength(1);
    expect(store.snapshot().securityMemories).toEqual([
      expect.objectContaining({
        kind: "false_positive",
        repositoryId: "repo_demo",
      }),
    ]);
    expect(store.snapshot().fixDecisionMemories).toEqual([
      expect.objectContaining({
        repositoryId: "repo_demo",
        findingFingerprint: body.finding.fingerprint,
        findingId: "finding_fp",
        ruleId: "missing-api-auth",
        decisionType: "false_positive",
        rationale:
          "Public admin test route is intentionally exposed in this fixture.",
      }),
    ]);
    expect(store.snapshot().auditLogs.map((log) => log.action)).toContain(
      "false_positive_marked",
    );
  });
});
