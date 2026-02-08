export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseServer";
import {
  claimFocusSessionSeat,
  mapSeatClaimCodeToHttpStatus,
  seatClaimMessage,
} from "../../_sharedSeatClaim";

type RouteContext = {
  params: { sessionId: string };
};

function isReservableStatus(status: string | null | undefined) {
  return status === "scheduled" || status === "active";
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = context.params.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: focusSession, error: focusSessionError } = await sb
    .from("focus_sessions")
    .select("id, start_at, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (focusSessionError) {
    console.error("[focus sessions] reserve lookup failed", focusSessionError);
    return NextResponse.json(
      { error: "Failed to load session." },
      { status: 500 },
    );
  }

  if (!focusSession) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const sessionStatus = focusSession.status ?? "scheduled";
  if (!isReservableStatus(sessionStatus)) {
    return NextResponse.json(
      { error: "Session is not available." },
      { status: 409 },
    );
  }

  const startsAt = new Date(focusSession.start_at);
  if (Number.isNaN(startsAt.valueOf())) {
    return NextResponse.json(
      { error: "Session time is invalid." },
      { status: 500 },
    );
  }

  const cutoff = new Date(startsAt.getTime() - 5 * 60 * 1000);
  if (Date.now() >= cutoff.getTime()) {
    return NextResponse.json(
      { error: "Reservations close 5 minutes before start." },
      { status: 409 },
    );
  }

  const { result, error } = await claimFocusSessionSeat({
    sessionId,
    userId: user.id,
    role: "participant",
  });

  if (error) {
    console.error("[focus sessions] reserve seat rpc failed", error);
    return NextResponse.json(
      { error: "Failed to reserve seat." },
      { status: 500 },
    );
  }

  const httpStatus = mapSeatClaimCodeToHttpStatus(result.code);
  if (httpStatus !== 200) {
    return NextResponse.json(
      { error: seatClaimMessage(result.code), code: result.code },
      { status: httpStatus },
    );
  }

  return NextResponse.json({
    status: result.code,
    participant_count: result.participantCount,
    max_participants: result.maxParticipants,
    my_role: result.myRole ?? "participant",
  });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = context.params.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: focusSession, error: focusSessionError } = await sb
    .from("focus_sessions")
    .select("id, host_id, start_at, status, max_participants")
    .eq("id", sessionId)
    .maybeSingle();

  if (focusSessionError) {
    console.error("[focus sessions] reserve cancel lookup failed", focusSessionError);
    return NextResponse.json(
      { error: "Failed to load session." },
      { status: 500 },
    );
  }

  if (!focusSession) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (focusSession.host_id === user.id) {
    return NextResponse.json(
      { error: "Hosts cannot cancel reservation here." },
      { status: 409 },
    );
  }

  const status = focusSession.status ?? "scheduled";
  if (!isReservableStatus(status)) {
    return NextResponse.json(
      { error: "Session is not available." },
      { status: 409 },
    );
  }

  const startsAt = new Date(focusSession.start_at);
  if (Number.isNaN(startsAt.valueOf())) {
    return NextResponse.json(
      { error: "Session time is invalid." },
      { status: 500 },
    );
  }

  const cutoff = new Date(startsAt.getTime() - 5 * 60 * 1000);
  if (Date.now() >= cutoff.getTime()) {
    return NextResponse.json(
      { error: "Reservation changes close 5 minutes before start." },
      { status: 409 },
    );
  }

  const { data: deletedRows, error: deleteError } = await sb
    .from("focus_session_participants")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .select("id");

  if (deleteError) {
    console.error("[focus sessions] reservation cancel failed", deleteError);
    return NextResponse.json(
      { error: "Failed to cancel reservation." },
      { status: 500 },
    );
  }

  const { count, error: countError } = await sb
    .from("focus_session_participants")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if (countError) {
    console.error(
      "[focus sessions] reservation count after cancel failed",
      countError,
    );
    return NextResponse.json(
      { error: "Failed to load reservation state." },
      { status: 500 },
    );
  }

  const didCancel = (deletedRows ?? []).length > 0;
  return NextResponse.json({
    status: didCancel ? "cancelled" : "not_reserved",
    participant_count: count ?? 0,
    max_participants: focusSession.max_participants ?? 3,
    my_role: null,
  });
}
