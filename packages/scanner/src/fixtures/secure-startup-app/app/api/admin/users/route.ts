import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session.userId || session.sessionClaims?.metadata?.role !== "admin") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return NextResponse.json({ users: [] });
}
