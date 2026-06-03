import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalScanner } from "../index";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("project type detection", () => {
  it("detects modern startup stack signals without executing the project", async () => {
    const scanner = createLocalScanner();

    const result = await scanner.scan({
      repositoryPath: join(fixturesRoot, "secure-startup-app")
    });

    expect(result.projectProfile).toEqual({
      frameworks: ["nextjs"],
      languages: ["typescript"],
      integrations: ["anthropic", "clerk", "openai", "stripe", "supabase"],
      deploymentProviders: ["vercel"],
      packageManagers: ["npm"]
    });
  });
});
