import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { clonePublicGitHubRepository, parsePublicGitHubUrl } from "./github-ingestion";

describe("public GitHub ingestion", () => {
  it("validates public GitHub repository URLs without accepting paths or non-GitHub hosts", () => {
    expect(parsePublicGitHubUrl("https://github.com/openai/codex")).toEqual({
      owner: "openai",
      repo: "codex",
      repoUrl: "https://github.com/openai/codex.git"
    });
    expect(parsePublicGitHubUrl("https://github.com/openai/codex.git")).toEqual({
      owner: "openai",
      repo: "codex",
      repoUrl: "https://github.com/openai/codex.git"
    });
    expect(parsePublicGitHubUrl("https://github.com/openai/codex/tree/main")).toBeNull();
    expect(parsePublicGitHubUrl("https://gitlab.com/openai/codex")).toBeNull();
  });

  it("clones into a scanner workdir and removes the temporary copy after callback scanning", async () => {
    const workdir = join(tmpdir(), `autocyber-github-ingestion-test-${Date.now()}`);
    let clonedPath = "";
    const result = await clonePublicGitHubRepository({
      repoUrl: "https://github.com/openai/codex",
      workdir,
      runGit: async (_command, args) => {
        clonedPath = String(args.at(-1));
        await mkdir(clonedPath, { recursive: true });
        await writeFile(join(clonedPath, "package.json"), "{}");
      },
      scan: async (repositoryPath) => {
        expect(repositoryPath).toBe(clonedPath);
        expect((await stat(repositoryPath)).isDirectory()).toBe(true);
        return { repositoryPath };
      }
    });

    expect(result.repositoryPath).toBe(clonedPath);
    await expect(stat(clonedPath)).rejects.toThrow();
  });

  it("uses isolated temporary directories for separate public clone scans", async () => {
    const workdir = join(tmpdir(), `autocyber-github-isolation-test-${Date.now()}`);
    const clonedPaths: string[] = [];

    await clonePublicGitHubRepository({
      repoUrl: "https://github.com/openai/codex",
      workdir,
      runGit: async (_command, args) => {
        const clonedPath = String(args.at(-1));
        clonedPaths.push(clonedPath);
        await mkdir(clonedPath, { recursive: true });
        await writeFile(join(clonedPath, "README.md"), "first clone");
      },
      scan: async (repositoryPath) => {
        expect(repositoryPath).toBe(clonedPaths[0]);
        return { repositoryPath };
      }
    });
    await clonePublicGitHubRepository({
      repoUrl: "https://github.com/openai/codex",
      workdir,
      runGit: async (_command, args) => {
        const clonedPath = String(args.at(-1));
        clonedPaths.push(clonedPath);
        await mkdir(clonedPath, { recursive: true });
        await writeFile(join(clonedPath, "README.md"), "second clone");
      },
      scan: async (repositoryPath) => {
        expect(repositoryPath).toBe(clonedPaths[1]);
        return { repositoryPath };
      }
    });

    expect(clonedPaths).toHaveLength(2);
    expect(clonedPaths[0]).not.toBe(clonedPaths[1]);
    await expect(stat(clonedPaths[0]!)).rejects.toThrow();
    await expect(stat(clonedPaths[1]!)).rejects.toThrow();
  });

  it("returns a safe private-repo-aware message when public clone fails", async () => {
    const workdir = join(tmpdir(), `autocyber-github-failure-test-${Date.now()}`);
    let clonedPath = "";

    await expect(
      clonePublicGitHubRepository({
        repoUrl: "https://github.com/acme/private-app",
        workdir,
        runGit: async (_command, args) => {
          clonedPath = String(args.at(-1));
          await mkdir(clonedPath, { recursive: true });
          throw new Error("fatal: could not read Username for 'https://github.com'");
        },
        scan: async () => ({ ok: true })
      })
    ).rejects.toMatchObject({
      code: "unreachable_public_repo",
      message: expect.stringContaining("Private GitHub monitoring")
    });
    await expect(stat(clonedPath)).rejects.toThrow();
  });

  it("removes the temporary clone when scanner execution throws", async () => {
    const workdir = join(tmpdir(), `autocyber-github-scan-failure-test-${Date.now()}`);
    let clonedPath = "";

    await expect(
      clonePublicGitHubRepository({
        repoUrl: "https://github.com/openai/codex",
        workdir,
        runGit: async (_command, args) => {
          clonedPath = String(args.at(-1));
          await mkdir(clonedPath, { recursive: true });
          await writeFile(join(clonedPath, "package.json"), "{}");
        },
        scan: async () => {
          throw new Error("simulated scanner failure");
        }
      })
    ).rejects.toMatchObject({ code: "unreachable_public_repo" });
    await expect(stat(clonedPath)).rejects.toThrow();
  });
});
