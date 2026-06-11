import { describe, expect, it } from "vitest";
import type { ScannerResult } from "@autocyber/scanner";
import { normalizeScannerResultForContext, ScanResultContextError } from "./scan-result-context";

describe("scan result context normalization", () => {
  it("makes scanner context ids authoritative over helper output", () => {
    const result = normalizeScannerResultForContext(
      createScannerResult({
        repositoryId: "repo_helper",
        scanJobId: "scan_helper",
        findingId: "finding_plain",
        findingRepositoryId: "repo_helper",
        findingScanJobId: "scan_helper"
      }),
      {
        repositoryId: "repo_authoritative",
        scanJobId: "scan_authoritative"
      }
    );

    expect(result.repositoryId).toBe("repo_authoritative");
    expect(result.scanJobId).toBe("scan_authoritative");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      repositoryId: "repo_authoritative",
      scanJobId: "scan_authoritative"
    });
  });

  it("rejects finding ids that encode a different scan context", () => {
    expect(() =>
      normalizeScannerResultForContext(
        createScannerResult({
          repositoryId: "repo_authoritative",
          scanJobId: "scan_authoritative",
          findingId: "scan_other:local:supabase-permissive-rls-policy:abc123",
          findingRepositoryId: "repo_authoritative",
          findingScanJobId: "scan_authoritative"
        }),
        {
          repositoryId: "repo_authoritative",
          scanJobId: "scan_authoritative"
        }
      )
    ).toThrow(ScanResultContextError);
  });
});

function createScannerResult(input: {
  repositoryId: string;
  scanJobId: string;
  findingId: string;
  findingRepositoryId: string;
  findingScanJobId: string;
}): ScannerResult {
  return {
    scanner: "local",
    repositoryPath: "/tmp/helper-output",
    repositoryId: input.repositoryId,
    scanJobId: input.scanJobId,
    projectProfile: {
      frameworks: [],
      languages: [],
      integrations: [],
      deploymentProviders: [],
      packageManagers: []
    },
    findings: [
      {
        id: input.findingId,
        repositoryId: input.findingRepositoryId,
        scanJobId: input.findingScanJobId,
        ruleId: "supabase-permissive-rls-policy",
        title: "Supabase migration contains an overly permissive RLS policy",
        category: "supabase-rls",
        severity: "high",
        confidence: 0.82,
        status: "open",
        stackTags: ["supabase"],
        affectedFile: "supabase/migrations/001_public_profiles.sql",
        evidence: [
          {
            filePath: "supabase/migrations/001_public_profiles.sql",
            startLine: 1,
            endLine: 1,
            snippet: "using (true)"
          }
        ],
        riskExplanation: "Permissive RLS can expose data.",
        remediationSummary: "Use scoped predicates.",
        verificationStrategy: "Rerun scanner.",
        autofixAvailable: false
      }
    ],
    filesScanned: 1,
    rulesRun: ["supabase-permissive-rls-policy"],
    errors: []
  };
}
