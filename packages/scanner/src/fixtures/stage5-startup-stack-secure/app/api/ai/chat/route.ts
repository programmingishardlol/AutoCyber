import OpenAI from "openai";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  await rateLimit(request);
  const { prompt } = await request.json();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return Response.json(await client.responses.create({ model: "gpt-4.1-mini", input: prompt }));
}
