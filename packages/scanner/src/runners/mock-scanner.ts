import type { Scanner, ScannerInput, ScannerResult } from "../types";

export function createMockScanner(): Scanner {
  return {
    async scan(input: ScannerInput): Promise<ScannerResult> {
      const repositoryId = input.repositoryId ?? "mock_repository";
      const scanJobId = input.scanJobId ?? "mock_scan";

      return {
        scanner: "mock",
        repositoryPath: input.repositoryPath,
        repositoryId,
        scanJobId,
        projectProfile: {
          frameworks: ["nextjs"],
          languages: ["typescript"],
          integrations: ["clerk"],
          deploymentProviders: ["vercel"],
          packageManagers: ["npm"]
        },
        filesScanned: 0,
        rulesRun: ["missing-api-auth"],
        errors: [],
        findings: [
          {
            id: `${scanJobId}:mock:missing-api-auth`,
            repositoryId,
            scanJobId,
            ruleId: "missing-api-auth",
            title: "Mock API route does not enforce authentication",
            category: "missing-auth",
            severity: "high",
            confidence: 0.8,
            status: "open",
            stackTags: ["nextjs", "clerk"],
            affectedFile: "app/api/admin/users/route.ts",
            evidence: [
              {
                filePath: "app/api/admin/users/route.ts",
                startLine: 1,
                endLine: 1,
                snippet: "Mock evidence for Stage 1 scanner flow."
              }
            ],
            riskExplanation: "This deterministic mock finding lets product surfaces exercise the scanner workflow before repository ingestion is wired in.",
            remediationSummary: "Use the local scanner for real file analysis; keep this mock scanner separate for demos and tests.",
            verificationStrategy: "Switch the scan source to local and verify the corresponding real scanner rules against repository files.",
            autofixAvailable: false
          }
        ]
      };
    }
  };
}
