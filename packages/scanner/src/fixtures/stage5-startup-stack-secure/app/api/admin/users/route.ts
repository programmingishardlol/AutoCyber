import { auth } from "@clerk/nextjs/server";

export async function GET() {
  const { userId, orgRole } = await auth();
  if (!userId || orgRole !== "org:admin") {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ users: [] });
}
