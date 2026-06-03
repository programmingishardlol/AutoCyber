import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "autocyber-web",
    stage: "stage-0-foundation"
  });
}
