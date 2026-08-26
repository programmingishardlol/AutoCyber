import { NextResponse } from "next/server";
import { generateEvidencePack } from "../../../lib/evidence-pack";
import { getPersistenceStore } from "../../../lib/persistence/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "invalid evidence pack input",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const selector = parseSelector(body);
  if (!selector) {
    return NextResponse.json(
      {
        error: "invalid evidence pack input",
        message:
          "Provide scanJobId or repositoryId to generate an evidence pack.",
      },
      { status: 400 },
    );
  }

  const store = getPersistenceStore();
  const scanJobs = await store.listScanJobs();
  const scanJob = selector.scanJobId
    ? await store.getScanJob(selector.scanJobId)
    : (scanJobs
        .filter((candidate) => candidate.repositoryId === selector.repositoryId)
        .sort((left, right) =>
          compareNullableDates(
            right.completedAt ?? right.startedAt,
            left.completedAt ?? left.startedAt,
          ),
        )[0] ?? null);

  if (!scanJob) {
    return NextResponse.json(
      { error: "not found", message: "The requested scan job was not found." },
      { status: 404 },
    );
  }

  const repository = await store.getRepository(scanJob.repositoryId);
  if (!repository) {
    return NextResponse.json(
      { error: "not found", message: "The scan repository was not found." },
      { status: 404 },
    );
  }

  const [findings, decisionMemories, verificationResults, fixProposals] =
    await Promise.all([
      store.listFindings(),
      store.listFixDecisionMemories({ repositoryId: repository.id }),
      store.listVerificationResults(),
      store.listFixProposals(),
    ]);
  const repositoryProposalIds = new Set(
    fixProposals
      .filter((proposal) => proposal.repositoryId === repository.id)
      .map((proposal) => proposal.id),
  );
  const evidencePack = generateEvidencePack({
    repository,
    scanJob,
    findings,
    decisionMemories,
    verificationResults: verificationResults.filter((result) =>
      repositoryProposalIds.has(result.fixProposalId),
    ),
  });

  return NextResponse.json({ evidencePack }, { status: 200 });
}

function parseSelector(
  value: unknown,
): { scanJobId?: string; repositoryId?: string } | null {
  if (!isRecord(value)) return null;
  const scanJobId =
    typeof value.scanJobId === "string" && value.scanJobId.trim()
      ? value.scanJobId.trim()
      : undefined;
  const repositoryId =
    typeof value.repositoryId === "string" && value.repositoryId.trim()
      ? value.repositoryId.trim()
      : undefined;
  return scanJobId || repositoryId ? { scanJobId, repositoryId } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function compareNullableDates(
  left: string | null,
  right: string | null,
): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return new Date(left).getTime() - new Date(right).getTime();
}
