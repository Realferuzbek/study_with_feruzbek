import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { ADMIN_EMAILS } from "@/lib/admin-emails";

const bodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
  confirmPassword: z.string(),
});

const PASSWORD_ERROR =
  "Password must include at least 8 characters, one uppercase letter, one lowercase letter, and one number.";

function deriveDisplayName(email: string) {
  const [local] = email.split("@");
  return local || email;
}

function isStrongPassword(password: string) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
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

  const email = payload.email.toLowerCase();
  const displayName = deriveDisplayName(email);

  try {
    const sb = supabaseAdmin();
    const passwordHash = await bcrypt.hash(payload.password, 12);
    const { error } = await sb.from("users").insert({
      email,
      password_hash: passwordHash,
      name: displayName,
      display_name: displayName,
      is_admin: ADMIN_EMAILS.has(email),
    });

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Email already registered" },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "Unable to create account" },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Unable to create account" },
      { status: 400 },
    );
  }
}
