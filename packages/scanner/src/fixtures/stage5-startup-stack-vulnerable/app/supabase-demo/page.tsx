"use client";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient("https://example.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY!);

export default function SupabaseDemo() {
  return <pre>{supabase.supabaseUrl}</pre>;
}
