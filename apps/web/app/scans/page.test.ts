import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("monitoring history page copy", () => {
  it("explains that queued webhook scans need worker processing", () => {
    const source = readFileSync("app/scans/page.tsx", "utf8");

    expect(source).toContain("Queued webhook scans are waiting for the queue worker");
    expect(source).toContain("Run the protected queue worker endpoint");
  });
});
