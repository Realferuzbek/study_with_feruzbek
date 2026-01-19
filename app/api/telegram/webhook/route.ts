// app/api/telegram/webhook/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

const TG_API = (method: string, token: string) =>
  `https://api.telegram.org/bot${token}/${method}`;
const TG_FILE = (path: string, token: string) =>
  `https://api.telegram.org/file/bot${token}/${path}`;

const baseAppUrl =
  process.env.NEXTAUTH_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

async function fetchAvatar(telegramUserId: number) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  try {
    // get user photos
    const photosRes = await fetch(TG_API("getUserProfilePhotos", token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: telegramUserId, limit: 1 }),
    });
    const photos = await photosRes.json();
    const first = photos?.result?.photos?.[0]?.[0];
    if (!first) return null;

    const fileRes = await fetch(TG_API("getFile", token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: first.file_id }),
    });
    const file = await fileRes.json();
    const filePath = file?.result?.file_path;
    if (!filePath) return null;

    const imgRes = await fetch(TG_FILE(filePath, token));
    const buff = Buffer.from(await imgRes.arrayBuffer());

    const sb = supabaseAdmin();
    // Ensure bucket 'avatars' exists manually once in Supabase UI
    const fileName = `tg/${telegramUserId}-${Date.now()}.jpg`;
    const { data, error } = await (sb as any).storage
      .from("avatars")
      .upload(fileName, buff, { contentType: "image/jpeg", upsert: true });

    if (error) return null;

    const { data: pub } = (sb as any).storage
      .from("avatars")
      .getPublicUrl(data.path);
    return pub?.publicUrl ?? null;
  } catch {
    return null;
  }
}

async function sendMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  await fetch(TG_API("sendMessage", token), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function consumeLinkToken(token: string) {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("link_tokens")
    .select("email,expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!data) return null;

  const expired = data.expires_at
    ? Date.parse(data.expires_at) < Date.now()
    : false;
  if (expired) {
    await sb.from("link_tokens").delete().eq("token", token);
    return null;
  }

  await sb.from("link_tokens").delete().eq("token", token);
  return data;
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecret = req.nextUrl.searchParams.get("secret");
  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: true });

  const message =
    body.message || body.edited_message || body.channel_post || {};
  const text: string = message.text || "";
  const from = message.from || {};
  const chatId = message.chat?.id;

  const videoChatStarted = message.video_chat_started;
  const videoChatEnded = message.video_chat_ended;
  const targetGroupId = process.env.TELEGRAM_GROUP_ID;
  const isTargetGroup =
    targetGroupId &&
    chatId !== undefined &&
    String(chatId) === String(targetGroupId);

  if (isTargetGroup && (videoChatStarted || videoChatEnded)) {
    const sb = supabaseAdmin();
    const isLive = !!videoChatStarted && !videoChatEnded;
    const { error } = await sb
      .from("live_stream_state")
      .update({ is_live: isLive, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error("Failed to update live stream state", error);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (!chatId) return NextResponse.json({ ok: true });

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    if (parts.length >= 2) {
      const payload = parts[1].trim();
      const claim = await consumeLinkToken(payload);
      if (!claim) {
        await sendMessage(
          chatId,
          "Link expired or invalid. Please tap the Link Telegram button inside the website again.",
        );
        return NextResponse.json({ ok: true });
      }

      const telegramUserId = Number(from.id);
      const username = from.username || null;

      const sb = supabaseAdmin();
      const email = (claim.email || "").toLowerCase();

      // verify telegram account not already linked to another user
      const { data: existing } = await sb
        .from("users")
        .select("id,email")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();

      if (existing && existing.email?.toLowerCase() !== email) {
        await sendMessage(
          chatId,
          "This Telegram account is already linked to another StudyMate profile. Tap Link Telegram from the site with the correct Google account.",
        );
        return NextResponse.json({ ok: true });
      }

      const { data: targetUser } = await sb
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (!targetUser) {
        await sendMessage(
          chatId,
          "We couldn’t locate your StudyMate profile. Please sign in with Google first, then tap Link Telegram again.",
        );
        return NextResponse.json({ ok: true });
      }

      const avatarUrl: string | null = await fetchAvatar(telegramUserId);

      await sb
        .from("users")
        .update({
          telegram_user_id: telegramUserId,
          telegram_username: username,
          avatar_url: avatarUrl,
        })
        .eq("id", targetUser.id);

      const entryUrl = `${baseAppUrl.replace(/\/$/, "")}/signin?inapp=telegram&callbackUrl=/dashboard`;
      await sendMessage(
        chatId,
        `✅ Telegram linked! You’re all set.\nContinue: ${entryUrl}\nIf the page still shows “Link Telegram”, keep it open—a refresh will move you automatically.`,
      );
      return NextResponse.json({ ok: true });
    }

    await sendMessage(
      chatId,
      "Hi! Please tap the Link Telegram button from https://thestudymate.vercel.app to get a secure code.",
    );
    return NextResponse.json({ ok: true });
  }

  // Fallback: ignore
  return NextResponse.json({ ok: true });
}
