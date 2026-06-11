import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getPersistenceStore } from "../../../../lib/persistence/store";
import { processQueuedScanJobs } from "../../../../lib/scan-queue";

export const runtime = "nodejs";

type ProcessQueueInput = {
  limit?: unknown;
};

export async function POST(request: Request) {
  const configuredSecret = process.env.AUTOCYBER_QUEUE_WORKER_SECRET;
  const providedSecret = request.headers.get("x-autocyber-worker-secret") ?? "";

  if (!configuredSecret) {
    return NextResponse.json(
      {
        error: "queue worker unavailable",
        message: "Queue worker processing is not configured for this environment."
      },
      { status: 503 }
    );
  }

  if (!isValidWorkerSecret(providedSecret, configuredSecret)) {
    return NextResponse.json(
      {
        error: "queue worker unauthorized",
        message: "Queue worker requests must include a valid worker secret."
      },
      { status: 401 }
    );
  }

  let input: ProcessQueueInput = {};
  try {
    input = (await request.json()) as ProcessQueueInput;
  } catch {
    input = {};
  }

  const result = await processQueuedScanJobs(getPersistenceStore(), {
    limit: typeof input.limit === "number" ? input.limit : undefined
  });

  return NextResponse.json({
    status: "processed",
    requestedLimit: result.requestedLimit,
    processed: result.processed,
    completed: result.completed,
    failed: result.failed,
    remainingQueued: result.remainingQueued,
    results: result.results.map((scanResult) => ({
      status: scanResult.status,
      scanJobId: scanResult.scanJobId,
      findings: scanResult.status === "completed" ? scanResult.findings : undefined,
      error: scanResult.status === "failed" ? scanResult.error : undefined
    }))
  });
}

function isValidWorkerSecret(providedSecret: string, configuredSecret: string): boolean {
  const provided = Buffer.from(providedSecret);
  const configured = Buffer.from(configuredSecret);
  if (provided.length !== configured.length) return false;
  return timingSafeEqual(provided, configured);
}
