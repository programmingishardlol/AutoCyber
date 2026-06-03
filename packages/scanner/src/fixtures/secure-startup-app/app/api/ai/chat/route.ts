import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function rateLimit(_request: Request) {
  return { allowed: true };
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session.userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  await rateLimit(request);

  const body = await request.json();

  return NextResponse.json({ model: "configured", length: String(body.prompt ?? "").length });
}

void openai;
