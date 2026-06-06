import { NextResponse } from "next/server";
import { getPersistenceStore } from "../../../../lib/persistence/store";
import { retryScanJob } from "../../../../lib/scan-queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let input: { scanJobId?: unknown };

  try {
    input = (await request.json()) as { scanJobId?: unknown };
  } catch {
    return NextResponse.json(
      {
        error: "invalid retry input",
        message: "Request body must be valid JSON."
      },
      { status: 400 }
    );
  }

  if (typeof input.scanJobId !== "string" || !input.scanJobId) {
    return NextResponse.json(
      {
        error: "invalid retry input",
        message: "A scanJobId is required."
      },
      { status: 400 }
    );
  }

  try {
    const scanJob = await retryScanJob(getPersistenceStore(), input.scanJobId);
    return NextResponse.json(
      {
        status: scanJob.status,
        scanJob: {
          id: scanJob.id,
          source: scanJob.source,
          branch: scanJob.branch,
          commitSha: scanJob.commitSha,
          pullRequestNumber: scanJob.pullRequestNumber
        }
      },
      { status: 202 }
    );
  } catch {
    return NextResponse.json(
      {
        error: "scan retry unavailable",
        message: "Only failed scan jobs can be retried."
      },
      { status: 400 }
    );
  }
}
