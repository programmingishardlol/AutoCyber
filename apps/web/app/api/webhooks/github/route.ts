import { handleGitHubWebhook } from "../../../../lib/github-webhook-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleGitHubWebhook(request);
}
