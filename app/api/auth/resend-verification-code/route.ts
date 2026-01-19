import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseServer";
import {
  generateVerificationCode,
  hashVerificationCode,
  isWithinResendCooldown,
  normalizeEmail,
  sendVerificationEmail,
  verificationExpiryDate,
} from "@/lib/email-verification";

const bodySchema = z.object({
  email: z.string().trim().email(),
});

const GENERIC_MESSAGE = "If the email exists, we sent a code.";

export async function POST(req: NextRequest) {
  let payload: z.infer<typeof bodySchema> | null = null;
  try {
    payload = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const email = normalizeEmail(payload.email);

  try {
    const sb = supabaseAdmin();
    const { data: user, error: userError } = await sb
      .from("users")
      .select("id,email_verified_at")
      .eq("email", email)
      .maybeSingle();

    if (userError || !user || user.email_verified_at) {
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    }

    const { data: latestCode } = await sb
      .from("email_verification_codes")
      .select("id,last_sent_at,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (isWithinResendCooldown(latestCode?.last_sent_at)) {
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    }

    await sb.from("email_verification_codes").delete().eq("user_id", user.id);

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    const expiresAt = verificationExpiryDate();
    const sentAt = new Date();

    const { error: insertError } = await sb
      .from("email_verification_codes")
      .insert({
        user_id: user.id,
        code_hash: codeHash,
        expires_at: expiresAt,
        last_sent_at: sentAt,
      });

    if (insertError) {
      console.error("[resend-email] failed to store code", insertError);
      return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
    }

    try {
      await sendVerificationEmail(email, code);
    } catch (error) {
      console.error("[resend-email] email send failed", error);
      await sb.from("email_verification_codes").delete().eq("user_id", user.id);
    }

    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (error) {
    console.error("[resend-email] unexpected error", error);
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }
}
