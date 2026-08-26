import { mkdir, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createScannerSession, removeScannerSession } from "./scanner-workdir";

const workdirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    workdirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("scanner workdir", () => {
  it("removes abandoned clone sessions without deleting recent sessions", async () => {
    const workdir = join(tmpdir(), `autocyber-workdir-test-${Date.now()}`);
    const staleSession = join(workdir, "github-abandoned");
    const recentSession = join(workdir, "github-app-active");
    workdirs.push(workdir);
    await mkdir(staleSession, { recursive: true });
    await mkdir(recentSession, { recursive: true });
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(staleSession, staleDate, staleDate);

    const session = await createScannerSession(workdir, "github-");

    await expect(stat(staleSession)).rejects.toThrow();
    await expect(stat(recentSession)).resolves.toMatchObject({});
    await expect(stat(session)).resolves.toMatchObject({});
    await removeScannerSession(session);
    await expect(stat(session)).rejects.toThrow();
  });
});
