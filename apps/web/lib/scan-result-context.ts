import type { ScannerResult } from "@autocyber/scanner";

export class ScanResultContextError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function normalizeScannerResultForContext(
  result: ScannerResult,
  context: { repositoryId: string; scanJobId: string }
): ScannerResult {
  for (const finding of result.findings) {
    if (encodesDifferentScanJob(finding.id, context.scanJobId)) {
      throw new ScanResultContextError("Scanner result finding id does not match the active scan context.");
    }
  }

  return {
    ...result,
    repositoryId: context.repositoryId,
    scanJobId: context.scanJobId,
    findings: result.findings.map((finding) => ({
      ...finding,
      repositoryId: context.repositoryId,
      scanJobId: context.scanJobId
    }))
  };
}

function encodesDifferentScanJob(findingId: string, scanJobId: string): boolean {
  const localScannerSeparator = ":local:";
  if (!findingId.includes(localScannerSeparator)) return false;
  return !findingId.startsWith(`${scanJobId}:`);
}
