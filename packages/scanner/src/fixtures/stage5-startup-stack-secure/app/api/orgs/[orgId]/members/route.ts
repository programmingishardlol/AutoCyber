import { auth } from "@clerk/nextjs/server";

export async function GET(_request: Request, { params }: { params: { orgId: string } }) {
  const { userId, orgId } = await auth();
  if (!userId || orgId !== params.orgId) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ members: [] });
}
