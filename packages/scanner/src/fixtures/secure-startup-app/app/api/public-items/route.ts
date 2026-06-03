import { createClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

export async function GET() {
  const session = await auth();
  if (!session.userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { data } = await supabase.from("profiles").select("id,name").eq("user_id", session.userId);

  return NextResponse.json({ data });
}
