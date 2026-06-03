import { mockDashboardSummary } from "@autocyber/core";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(mockDashboardSummary);
}
