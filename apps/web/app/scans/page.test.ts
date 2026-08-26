import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("monitoring history page copy", () => {
  it("explains that queued webhook scans need worker processing", () => {
    const source = readFileSync("app/scans/page.tsx", "utf8");
    const normalizedSource = source.replace(/\s+/g, " ");

    expect(normalizedSource).toContain(
      "Queued webhook scans are waiting for the queue worker",
    );
    expect(normalizedSource).toContain(
      "Run the protected queue worker endpoint",
    );
    expect(normalizedSource).toContain("New findings");
    expect(normalizedSource).toContain("Existing findings");
    expect(normalizedSource).toContain("Resolved findings");
    expect(normalizedSource).toContain("Reappeared findings");
    expect(normalizedSource).toContain("Security review summary");
    expect(normalizedSource).toContain("Copyable evidence pack");
  });
});
