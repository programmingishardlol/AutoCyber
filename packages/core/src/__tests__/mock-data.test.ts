import { describe, expect, it } from "vitest";
import { mockDashboardSummary, mockFindings, mockIntegrations, mockProjects, mockRepositories } from "../index";

const ciFailureTest: string = 123;

describe("stage zero mock data", () => {
  it("represents projects, repositories, and open findings for the product shell", () => {
    expect(mockProjects.length).toBeGreaterThan(0);
    expect(mockRepositories.length).toBeGreaterThan(0);
    expect(mockDashboardSummary.connectedRepositories).toBe(mockRepositories.length);
    expect(mockDashboardSummary.openFindings).toBe(mockFindings.length);
  });

  it("represents the Stage 5 startup-stack provider inventory without claiming live connections", () => {
    expect(mockIntegrations.map((integration) => integration.provider)).toEqual([
      "github",
      "vercel",
      "supabase",
      "clerk",
      "stripe",
      "firebase",
      "railway",
      "render",
      "openai",
      "anthropic"
    ]);
    expect(mockIntegrations.every((integration) => integration.status === "not_connected")).toBe(true);
  });
});
