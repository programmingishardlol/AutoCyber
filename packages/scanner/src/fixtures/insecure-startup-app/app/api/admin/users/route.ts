import { NextResponse } from "next/server";

export async function GET() {
  const users = [{ id: "user_1", email: "founder@example.test" }];

  return NextResponse.json({ users });
}
