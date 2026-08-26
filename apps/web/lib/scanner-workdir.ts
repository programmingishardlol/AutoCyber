import { mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const cloneSessionPrefixes = ["github-", "github-app-"];
const staleSessionAgeMs = 24 * 60 * 60 * 1000;

export async function createScannerSession(
  workdir: string,
  prefix: "github-" | "github-app-",
): Promise<string> {
  await mkdir(workdir, { recursive: true });
  await removeStaleScannerSessions(workdir);
  return mkdtemp(join(workdir, prefix));
}

export async function removeScannerSession(sessionDir: string): Promise<void> {
  await rm(sessionDir, { recursive: true, force: true });
}

async function removeStaleScannerSessions(workdir: string): Promise<void> {
  const entries = await readdir(workdir, { withFileTypes: true }).catch(
    () => [],
  );
  const cutoff = Date.now() - staleSessionAgeMs;

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          cloneSessionPrefixes.some((prefix) => entry.name.startsWith(prefix)),
      )
      .map(async (entry) => {
        const path = join(workdir, entry.name);
        const metadata = await stat(path).catch(() => null);
        if (metadata && metadata.mtimeMs < cutoff) {
          await rm(path, { recursive: true, force: true });
        }
      }),
  );
}
