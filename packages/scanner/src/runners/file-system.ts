import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import type { ScannerError, ScannedFile } from "../types";

const ignoredDirectories = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo"]);
const textExtensions = new Set([
  "",
  ".cjs",
  ".css",
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);

export interface ReadRepositoryFilesResult {
  files: ScannedFile[];
  errors: ScannerError[];
}

export async function readRepositoryFiles(repositoryPath: string, maxFileSizeBytes: number): Promise<ReadRepositoryFilesResult> {
  const files: ScannedFile[] = [];
  const errors: ScannerError[] = [];

  async function visit(directory: string) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      errors.push({ path: toRelativePath(repositoryPath, directory), message: String(error) });
      return;
    }

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }

      if (!entry.isFile() || !isTextPath(entry.name)) {
        continue;
      }

      try {
        const fileStat = await stat(absolutePath);
        if (fileStat.size > maxFileSizeBytes) {
          continue;
        }

        files.push({
          path: absolutePath,
          relativePath: toRelativePath(repositoryPath, absolutePath),
          content: await readFile(absolutePath, "utf8")
        });
      } catch (error) {
        errors.push({ path: toRelativePath(repositoryPath, absolutePath), message: String(error) });
      }
    }
  }

  await visit(repositoryPath);

  return { files, errors };
}

function isTextPath(fileName: string): boolean {
  if (fileName.startsWith(".env")) return true;
  return textExtensions.has(extname(fileName));
}

function toRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}
