export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

type WebhookPayload = Record<string, unknown>;

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const candidate = readString(value);
    if (candidate) return candidate;
  }
  return null;
}

function extractEventType(payload: WebhookPayload) {
  return firstString(
    payload.type,
    payload.event_type,
    (payload.event as WebhookPayload | undefined)?.type,
    (payload.event as WebhookPayload | undefined)?.name,
  );
}

function extractRoomId(payload: WebhookPayload) {
  const data = payload.data as WebhookPayload | undefined;
  return firstString(
    payload.room_id,
    (payload.room as WebhookPayload | undefined)?.id,
    data?.room_id,
    (data?.room as WebhookPayload | undefined)?.id,
  );
}

function extractPeerId(payload: WebhookPayload) {
  const data = payload.data as WebhookPayload | undefined;
  return firstString(
    payload.peer_id,
    (payload.peer as WebhookPayload | undefined)?.id,
    data?.peer_id,
    (data?.peer as WebhookPayload | undefined)?.id,
  );
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.STUDYMATE_WEBHOOK_SECRET ?? "";
  const incomingSecret = req.headers.get("x-studymate-webhook-secret") ?? "";
  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: WebhookPayload | null = null;
  try {
    payload = (await req.json()) ?? null;
  } catch (err) {
    console.warn("[100ms webhook] invalid json", err);
    return NextResponse.json({ ok: true });
  }

  if (payload && typeof payload === "object") {
    const eventType = extractEventType(payload);
    const roomId = extractRoomId(payload);
    const peerId = extractPeerId(payload);
    console.info("[100ms webhook]", {
      eventType,
      roomId,
      peerId,
    });
  } else {
    console.info("[100ms webhook] empty payload");
  }

  return NextResponse.json({ ok: true });
}
