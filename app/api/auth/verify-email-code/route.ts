import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseServer";
import {
  normalizeEmail,
  VERIFICATION_CODE_REGEX,
} from "@/lib/email-verification";

const bodySchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim(),
});

export async function POST(req: NextRequest) {
  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = normalizeEmail(payload.email);
  const code = payload.code.trim();

  if (!VERIFICATION_CODE_REGEX.test(code)) {
    return NextResponse.json({ error: "Incorrect code" }, { status: 400 });
  }

  try {
    const sb = supabaseAdmin();
    const { data: user, error: userError } = await sb
      .from("users")
      .select("id,email_verified_at")
      .eq("email", email)
      .maybeSingle();

    if (userError) {
      return NextResponse.json(
        { error: "Unable to verify code" },
        { status: 500 },
      );
    }

    if (!user) {
      return NextResponse.json({ error: "Incorrect code" }, { status: 400 });
    }

    if (user.email_verified_at) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    const { data: codeRow, error: codeError } = await sb
      .from("email_verification_codes")
      .select("id,code_hash,expires_at,attempts,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeError) {
      return NextResponse.json(
        { error: "Unable to verify code" },
        { status: 500 },
      );
    }

    if (!codeRow?.code_hash) {
      return NextResponse.json(
        { error: "Code expired. Please resend." },
        { status: 400 },
      );
    }

    const expiresAt = Date.parse(codeRow.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      return NextResponse.json(
        { error: "Code expired. Please resend." },
        { status: 400 },
      );
    }

    const attempts = Number.isFinite(codeRow.attempts)
      ? codeRow.attempts
      : 0;
    if (attempts >= 5) {
      return NextResponse.json(
        { error: "Too many attempts. Please resend." },
        { status: 429 },
      );
    }

    const matches = await bcrypt.compare(code, codeRow.code_hash);
    if (!matches) {
      await sb
        .from("email_verification_codes")
        .update({ attempts: attempts + 1 })
        .eq("id", codeRow.id);
      return NextResponse.json({ error: "Incorrect code" }, { status: 400 });
    }

    const { error: verifyError } = await sb
      .from("users")
      .update({ email_verified_at: new Date() })
      .eq("id", user.id);

    if (verifyError) {
      return NextResponse.json(
        { error: "Unable to verify code" },
        { status: 500 },
      );
    }

    await sb
      .from("email_verification_codes")
      .delete()
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true, verified: true });
  } catch (error) {
    console.error("[verify-email] failed", error);
    return NextResponse.json(
      { error: "Unable to verify code" },
      { status: 500 },
    );
  }
}
