"use client";

export function AiWidget() {
  const key = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  return <div>{key ? "ready" : "missing"}</div>;
}
