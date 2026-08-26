import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("health route", () => {
  it("returns process liveness without exposing configuration", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "autocyber-web",
      stage: "stage-7-security-memory",
    });
  });
});
