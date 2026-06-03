import { describe, expect, it } from "vitest";
import { getIntegrationCapability } from "./integration-capabilities";

describe("integration capability labels", () => {
  it("describes the GitHub token prototype without claiming a live connection", () => {
    expect(getIntegrationCapability("github")).toEqual({
      label: "Token-mode PR prototype",
      tone: "blue"
    });
  });

  it("marks implemented Stage 5 scanner providers as scanner coverage", () => {
    for (const provider of ["vercel", "supabase", "clerk", "stripe", "openai", "anthropic"] as const) {
      expect(getIntegrationCapability(provider)).toEqual({
        label: "Scanner checks available",
        tone: "green"
      });
    }
  });

  it("marks providers without Stage 5 scanner coverage as planned", () => {
    for (const provider of ["firebase", "railway", "render"] as const) {
      expect(getIntegrationCapability(provider)).toEqual({
        label: "Planned",
        tone: "gray"
      });
    }
  });
});
