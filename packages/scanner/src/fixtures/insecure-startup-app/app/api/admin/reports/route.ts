import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session.userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return NextResponse.json({ reports: [{ id: "report_1", name: "Revenue" }] });
}
