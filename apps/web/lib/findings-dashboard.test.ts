import { describe, expect, it } from "vitest";
import type { NormalizedFinding } from "@autocyber/scanner";
import {
  createFindingDetailHref,
  createFindingDetailKey,
  filterFindings,
  getFindingFilterOptions,
  resolveFindingDetail,
  sortFindingsForDashboard
} from "./findings-dashboard";

const findings: NormalizedFinding[] = [
  createFinding({
    ruleId: "unsafe-cors-wildcard",
    title: "CORS allows requests from any origin",
    category: "network-security",
    severity: "medium",
    confidence: 0.78,
    status: "triaged",
    stackTags: ["node"],
    affectedFile: "src/server.ts"
  }),
  createFinding({
    ruleId: "missing-api-auth",
    title: "API route missing authentication",
    category: "access-control",
    severity: "high",
    confidence: 0.9,
    status: "open",
    stackTags: ["nextjs", "clerk"],
    affectedFile: "app/api/admin/users/route.ts"
  }),
  createFinding({
    ruleId: "missing-security-headers",
    title: "Security headers are missing",
    category: "headers",
    severity: "medium",
    confidence: 0.68,
    status: "open",
    stackTags: ["nextjs", "vercel"],
    affectedFile: "next.config.mjs"
  })
];

describe("findings dashboard helpers", () => {
  it("sorts findings by severity before confidence", () => {
    const sorted = sortFindingsForDashboard(findings);

    expect(sorted.map((finding) => finding.ruleId)).toEqual([
      "missing-api-auth",
      "unsafe-cors-wildcard",
      "missing-security-headers"
    ]);
  });

  it("filters by severity, category, stack, and status", () => {
    const filtered = filterFindings(findings, {
      severity: "high",
      category: "access-control",
      stack: "nextjs",
      status: "open"
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.ruleId).toBe("missing-api-auth");
  });

  it("derives stable filter options from real finding fields", () => {
    const options = getFindingFilterOptions(findings);

    expect(options.severities).toEqual(["high", "medium"]);
    expect(options.categories).toEqual(["access-control", "headers", "network-security"]);
    expect(options.stacks).toEqual(["clerk", "nextjs", "node", "vercel"]);
    expect(options.statuses).toEqual(["open", "triaged"]);
  });

  it("resolves detail pages by rule id or stable finding key", () => {
    const finding = findings[1]!;
    const detailKey = createFindingDetailKey(finding);

    expect(detailKey).not.toContain("/");
    expect(resolveFindingDetail(findings, finding.ruleId)?.affectedFile).toBe("app/api/admin/users/route.ts");
    expect(resolveFindingDetail(findings, detailKey)?.ruleId).toBe("missing-api-auth");
  });

  it("builds finding-detail links that preserve local scanner context", () => {
    const finding = findings[1]!;
    const href = createFindingDetailHref(finding, {
      source: "local",
      path: "/private/tmp/demo repo",
      repoUrl: ""
    });
    const [pathname, query] = href.split("?");

    expect(pathname).toBe(`/findings/${createFindingDetailKey(finding)}`);
    expect(new URLSearchParams(query).get("source")).toBe("local");
    expect(new URLSearchParams(query).get("path")).toBe("/private/tmp/demo repo");
  });
});

function createFinding(overrides: Partial<NormalizedFinding>): NormalizedFinding {
  return {
    id: `scan_test:${overrides.ruleId}:0`,
    repositoryId: "repo_test",
    scanJobId: "scan_test",
    ruleId: "exposed-secret",
    title: "Finding",
    category: "test",
    severity: "low",
    confidence: 0.5,
    status: "open",
    stackTags: [],
    affectedFile: "file.ts",
    evidence: [
      {
        filePath: "file.ts",
        startLine: 1,
        endLine: 1,
        snippet: "evidence"
      }
    ],
    riskExplanation: "Risk explanation.",
    remediationSummary: "Recommendation.",
    verificationStrategy: "Rerun scanner.",
    autofixAvailable: false,
    ...overrides
  };
}
