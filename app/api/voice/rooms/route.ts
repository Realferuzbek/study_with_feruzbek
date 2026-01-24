export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { buildHmsRoomName, createHmsManagementToken } from "@/lib/voice/hms";

type CreateRoomPayload = {
  title?: string;
  description?: string | null;
  visibility?: "public" | "unlisted";
  max_size?: number;
};

function parseMaxSize(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = Math.floor(value);
    return parsed >= 2 && parsed <= 200 ? parsed : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const normalized = Math.floor(parsed);
      return normalized >= 2 && normalized <= 200 ? normalized : null;
    }
  }
  return null;
}

function resolveDefaultMaxSize() {
  const parsed = Number(process.env.LIVE_ROOMS_DEFAULT_MAX_SIZE);
  if (Number.isFinite(parsed)) {
    return Math.max(2, Math.min(200, Math.floor(parsed)));
  }
  return 30;
}

function resolveDefaultVisibility() {
  const raw = (process.env.LIVE_ROOMS_DEFAULT_VISIBILITY ?? "").toLowerCase();
  return raw === "unlisted" ? "unlisted" : "public";
}

async function requireUser() {
  const session = await auth();
  const user = session?.user as { id?: string } | undefined;
  if (!user?.id) return null;
  return user;
}

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("live_voice_rooms")
    .select(
      "id, created_at, created_by, title, description, visibility, status, max_size",
    )
    .eq("status", "active")
    .eq("visibility", "public")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[voice rooms] list failed", error);
    return NextResponse.json(
      { error: "Failed to load rooms" },
      { status: 500 },
    );
  }

  const creatorIds = Array.from(
    new Set((data ?? []).map((room) => room.created_by).filter(Boolean)),
  );
  const creatorIndex = new Map<
    string,
    { display_name?: string | null; name?: string | null; avatar_url?: string | null }
  >();

  if (creatorIds.length) {
    const { data: creators } = await sb
      .from("users")
      .select("id, display_name, name, avatar_url")
      .in("id", creatorIds);
    (creators ?? []).forEach((creator) => {
      if (!creator?.id) return;
      creatorIndex.set(creator.id, {
        display_name: creator.display_name ?? null,
        name: creator.name ?? null,
        avatar_url: creator.avatar_url ?? null,
      });
    });
  }

  const rooms = (data ?? []).map((room) => {
    const creator = creatorIndex.get(room.created_by);
    return {
      ...room,
      created_by_name: creator?.display_name ?? creator?.name ?? null,
      created_by_avatar_url: creator?.avatar_url ?? null,
    };
  });

  return NextResponse.json({ rooms });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: CreateRoomPayload = {};
  try {
    payload = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const description =
    typeof payload.description === "string" && payload.description.trim()
      ? payload.description.trim()
      : null;
  let visibility = resolveDefaultVisibility();
  if (payload.visibility !== undefined) {
    if (payload.visibility !== "public" && payload.visibility !== "unlisted") {
      return NextResponse.json(
        { error: "Visibility must be public or unlisted" },
        { status: 400 },
      );
    }
    visibility = payload.visibility;
  }

  const defaultMaxSize = resolveDefaultMaxSize();
  let maxSize = defaultMaxSize;
  if (payload.max_size !== undefined) {
    const parsed = parseMaxSize(payload.max_size);
    if (parsed === null) {
      return NextResponse.json(
        { error: "Max size must be between 2 and 200" },
        { status: 400 },
      );
    }
    maxSize = parsed;
  }

  const sb = supabaseAdmin();
  const { data: existingRooms, error: existingRoomError } = await sb
    .from("live_voice_rooms")
    .select("id")
    .eq("created_by", user.id)
    .eq("status", "active")
    .limit(1);

  if (existingRoomError) {
    console.error("[voice rooms] active room lookup failed", existingRoomError);
    return NextResponse.json(
      { error: "Failed to check existing rooms" },
      { status: 500 },
    );
  }

  if (existingRooms && existingRooms.length > 0) {
    return NextResponse.json(
      {
        error:
          "You already have an active room. End it before creating a new one.",
      },
      { status: 409 },
    );
  }

  const accessKey = process.env.HMS_APP_ACCESS_KEY;
  const secret = process.env.HMS_APP_SECRET;
  if (!accessKey || !secret) {
    return NextResponse.json(
      { error: "100ms credentials missing" },
      { status: 500 },
    );
  }

  const roomName = buildHmsRoomName(title);
  const managementToken = createHmsManagementToken(accessKey, secret);
  const templateId = process.env.HMS_TEMPLATE_ID;

  const createPayload: Record<string, unknown> = {
    name: roomName,
    description: description ?? undefined,
    region: "auto",
    size: maxSize,
  };
  if (templateId) createPayload.template_id = templateId;

  const response = await fetch("https://api.100ms.live/v2/rooms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${managementToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createPayload),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("[voice rooms] 100ms room create failed", detail);
    return NextResponse.json(
      { error: "Failed to create 100ms room" },
      { status: 502 },
    );
  }

  const created = (await response.json()) as {
    id?: string;
    name?: string;
  };
  if (!created?.id) {
    return NextResponse.json(
      { error: "100ms room creation failed" },
      { status: 502 },
    );
  }

  const { data: inserted, error } = await sb
    .from("live_voice_rooms")
    .insert({
      created_by: user.id,
      title,
      description,
      visibility,
      status: "active",
      hms_room_id: created.id,
      hms_room_name: created.name ?? roomName,
      max_size: maxSize,
    })
    .select("id")
    .single();

  if (error || !inserted?.id) {
    console.error("[voice rooms] insert failed", error);
    return NextResponse.json(
      { error: "Failed to store room" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: inserted.id });
}
