import { describe, expect, it } from "vitest";
import { createMockScanner } from "../index";

describe("mock scanner", () => {
  it("returns deterministic mock findings without reading local repository files", async () => {
    const scanner = createMockScanner();

    const result = await scanner.scan({
      repositoryPath: "/path/that/does/not/need/to/exist",
      repositoryId: "repo_mock",
      scanJobId: "scan_mock"
    });

    expect(result.scanner).toBe("mock");
    expect(result.filesScanned).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      id: "scan_mock:mock:missing-api-auth",
      repositoryId: "repo_mock",
      scanJobId: "scan_mock",
      ruleId: "missing-api-auth",
      status: "open"
    });
  });
});
