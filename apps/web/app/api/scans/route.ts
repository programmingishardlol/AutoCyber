import { NextResponse } from "next/server";
import { runScan, type ScanRequestInput } from "../../../lib/scanner-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let input: ScanRequestInput;

  try {
    input = (await request.json()) as ScanRequestInput;
  } catch {
    return NextResponse.json(
      {
        error: "invalid repo input",
        message: "Request body must be valid JSON."
      },
      { status: 400 }
    );
  }

  const result = await runScan(input);
  return NextResponse.json(result.body, { status: result.status });
}
