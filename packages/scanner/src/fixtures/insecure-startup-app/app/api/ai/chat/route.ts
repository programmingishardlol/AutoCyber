import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({ apiKey: "sk-proj-autocyberfixture111111111111111111111111" });

export async function POST(request: Request) {
  const body = await request.json();
  console.log("prompt", body.prompt, process.env.OPENAI_API_KEY);

  return NextResponse.json({ ok: true });
}
