import bcrypt from "bcryptjs";

const RESEND_API_URL = "https://api.resend.com/emails";
const VERIFICATION_CODE_LENGTH = 6;
const CODE_HASH_COST = 10;

export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
export const VERIFICATION_CODE_REGEX = /^\d{6}$/;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function generateVerificationCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(
    VERIFICATION_CODE_LENGTH,
    "0",
  );
}

export function verificationExpiryDate(now = Date.now()) {
  return new Date(now + VERIFICATION_CODE_TTL_MS);
}

export function isWithinResendCooldown(
  lastSentAt: string | Date | null | undefined,
  now = Date.now(),
) {
  if (!lastSentAt) return false;
  const timestamp =
    typeof lastSentAt === "string"
      ? Date.parse(lastSentAt)
      : lastSentAt.getTime();
  if (!Number.isFinite(timestamp)) return false;
  return now - timestamp < VERIFICATION_RESEND_COOLDOWN_MS;
}

export async function hashVerificationCode(code: string) {
  return bcrypt.hash(code, CODE_HASH_COST);
}

export async function sendVerificationEmail(email: string, code: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error("Missing RESEND_API_KEY or EMAIL_FROM");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "StudyMate verification code",
      text: `Your verification code is: ${code}`,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Resend failed: ${response.status} ${details}`);
  }
}
