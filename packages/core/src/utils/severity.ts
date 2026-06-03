import type { Finding, Severity } from "../types/domain";

export const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

export function sortFindingsByRisk(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const severityDelta = severityRank[right.severity] - severityRank[left.severity];
    if (severityDelta !== 0) return severityDelta;

    return right.confidence - left.confidence;
  });
}
