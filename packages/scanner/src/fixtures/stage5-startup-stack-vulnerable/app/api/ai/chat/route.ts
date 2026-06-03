import OpenAI from "openai";

export async function POST(request: Request) {
  const { prompt } = await request.json();
  console.log("prompt", prompt);

  // Intentionally bad: no rate limit, quota, or abuse protection is enforced here.
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return Response.json(await client.responses.create({ model: "gpt-4.1-mini", input: prompt }));
}
