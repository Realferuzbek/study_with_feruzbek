import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { ADMIN_EMAILS } from "@/lib/admin-emails";
import {
  generateVerificationCode,
  hashVerificationCode,
  normalizeEmail,
  sendVerificationEmail,
  verificationExpiryDate,
} from "@/lib/email-verification";

const bodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
  confirmPassword: z.string(),
});

const PASSWORD_ERROR =
  "Password must include at least 6 characters, one uppercase letter, one lowercase letter, and one number.";

function deriveDisplayName(email: string) {
  const [local] = email.split("@");
  return local || email;
}

function isStrongPassword(password: string) {
  return (
    password.length >= 6 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

async function cleanupUser(userId: string) {
  try {
    const sb = supabaseAdmin();
    await sb.from("users").delete().eq("id", userId);
  } catch (error) {
    console.error("[register] cleanup failed", error);
  }
}

export async function POST(req: NextRequest) {
  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!isStrongPassword(payload.password)) {
    return NextResponse.json({ error: PASSWORD_ERROR }, { status: 400 });
  }

  if (payload.password !== payload.confirmPassword) {
    return NextResponse.json(
      { error: "Passwords do not match" },
      { status: 400 },
    );
  }

  const email = normalizeEmail(payload.email);
  const displayName = deriveDisplayName(email);

  try {
    const sb = supabaseAdmin();

    const { data: existing, error: existingError } = await sb
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: "Unable to create account" },
        { status: 500 },
      );
    }

    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(payload.password, 12);
    const { data: user, error: insertError } = await sb
      .from("users")
      .insert({
        email,
        password_hash: passwordHash,
        name: displayName,
        display_name: displayName,
        is_admin: ADMIN_EMAILS.has(email),
        email_verified_at: null,
      })
      .select("id,email")
      .single();

    if (insertError || !user) {
      if ((insertError as { code?: string })?.code === "23505") {
        return NextResponse.json(
          { error: "Email already registered" },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Unable to create account" },
        { status: 500 },
      );
    }

    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(code);
    const expiresAt = verificationExpiryDate();
    const sentAt = new Date();

    const { error: deleteError } = await sb
      .from("email_verification_codes")
      .delete()
      .eq("user_id", user.id);

    if (deleteError) {
      await cleanupUser(user.id);
      return NextResponse.json(
        { error: "Unable to create account" },
        { status: 500 },
      );
    }

    const { error: codeError } = await sb
      .from("email_verification_codes")
      .insert({
        user_id: user.id,
        code_hash: codeHash,
        expires_at: expiresAt,
        last_sent_at: sentAt,
      });

    if (codeError) {
      await cleanupUser(user.id);
      return NextResponse.json(
        { error: "Unable to create account" },
        { status: 500 },
      );
    }

    try {
      await sendVerificationEmail(email, code);
    } catch (error) {
      await cleanupUser(user.id);
      console.error("[register] verification email failed", error);
      return NextResponse.json(
        {
          error:
            "We couldn't send your verification email. Please try again.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, needsVerification: true, email });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Unable to create account" },
      { status: 500 },
    );
  }
}
