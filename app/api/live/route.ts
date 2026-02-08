export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export async function GET() {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("live_status")
    .select("state,scheduled_at")
    .eq("id", 1)
    .maybeSingle();
  const joinUrl = process.env.PUBLIC_TG_GROUP_LINK || "https://t.me/";
  if (!data) return NextResponse.json({ state: "none", joinUrl });
  return NextResponse.json({
    state: data.state,
    scheduledAt: data.scheduled_at,
    joinUrl,
  });
}
