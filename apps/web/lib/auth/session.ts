export interface AuthContext {
  userId: string;
  teamId: string;
  mode: "clerk" | "development";
}

export async function getCurrentAuthContext(): Promise<AuthContext> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    return {
      userId: "user_dev",
      teamId: "team_dev",
      mode: "development"
    };
  }

  const { auth } = await import("@clerk/nextjs/server");
  const session = await auth();
  const userId = session.userId ?? "user_unknown";

  return {
    userId,
    teamId: session.orgId ?? `team_${userId}`,
    mode: "clerk"
  };
}
