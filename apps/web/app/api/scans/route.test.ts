import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("scan API route", () => {
  it("rejects invalid GitHub URL scans with a safe error", async () => {
    const response = await POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        body: JSON.stringify({
          source: "github",
          repoUrl: "https://gitlab.com/example/app",
        }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid repo input");
    expect(body.message).toContain("public GitHub repository URL");
  });

  it("rejects invalid local paths without exposing stack traces", async () => {
    const response = await POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        body: JSON.stringify({
          source: "local",
          path: "/etc",
        }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("path not allowed");
    expect(JSON.stringify(body)).not.toContain("Error:");
  });
});
