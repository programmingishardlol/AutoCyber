import { NextResponse } from "next/server";
import { generateFixProposal, type RemediationFinding } from "@autocyber/remediation";
import { getPersistenceStore } from "../../../lib/persistence/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid proposal input", message: "Request body must be valid JSON." }, { status: 400 });
  }

  const finding = parseFinding(body);
  if (!finding) {
    return NextResponse.json(
      {
        error: "invalid proposal input",
        message: "A normalized finding with id, repositoryId, title, category, affectedFile, evidence, and remediation fields is required."
      },
      { status: 400 }
    );
  }

  const proposal = generateFixProposal(finding);
  await getPersistenceStore().saveFixProposal(proposal);

  return NextResponse.json({ proposal }, { status: 200 });
}

function parseFinding(value: unknown): RemediationFinding | null {
  if (!isRecord(value)) return null;
  const finding = isRecord(value.finding) ? value.finding : value;

  if (
    !hasString(finding, "id") ||
    !hasString(finding, "repositoryId") ||
    !hasString(finding, "title") ||
    !hasString(finding, "category") ||
    !hasString(finding, "severity") ||
    !hasString(finding, "status") ||
    !hasString(finding, "affectedFile") ||
    !hasString(finding, "riskExplanation") ||
    !hasString(finding, "remediationSummary") ||
    !Array.isArray(finding.evidence) ||
    !Array.isArray(finding.stackTags) ||
    typeof finding.confidence !== "number" ||
    typeof finding.autofixAvailable !== "boolean"
  ) {
    return null;
  }

  return finding as unknown as RemediationFinding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}
