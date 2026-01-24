export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseServer";

type RouteContext = {
  params: { sessionId: string };
};

async function cancelSession(req: NextRequest, context: RouteContext) {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = context.params.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  let payload: { status?: string } = {};
  try {
    if (req.method !== "DELETE") {
      payload = (await req.json()) ?? {};
    }
  } catch {}

  if (payload.status && payload.status !== "cancelled") {
    return NextResponse.json(
      { error: "Unsupported status update" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("focus_sessions")
    .select("id, creator_user_id, starts_at, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("[focus sessions] cancel lookup failed", error);
    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (data.creator_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startsAt = new Date(data.starts_at);
  if (Number.isNaN(startsAt.valueOf())) {
    return NextResponse.json(
      { error: "Session time is invalid" },
      { status: 500 },
    );
  }

  if (Date.now() >= startsAt.getTime()) {
    return NextResponse.json(
      { error: "Session has already started" },
      { status: 409 },
    );
  }

  if (data.status === "cancelled") {
    return NextResponse.json({ session: data });
  }

  const { data: updated, error: updateError } = await sb
    .from("focus_sessions")
    .update({ status: "cancelled" })
    .eq("id", sessionId)
    .select("id, status, starts_at, ends_at, creator_user_id")
    .single();

  if (updateError) {
    console.error("[focus sessions] cancel update failed", updateError);
    return NextResponse.json(
      { error: "Failed to cancel session" },
      { status: 500 },
    );
  }

  return NextResponse.json({ session: updated });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  return cancelSession(req, context);
}

export async function POST(req: NextRequest, context: RouteContext) {
  return cancelSession(req, context);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  return cancelSession(req, context);
}
