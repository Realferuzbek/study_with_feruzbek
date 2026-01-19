// lib/auth.ts
import NextAuth, { getServerSession, type NextAuthOptions } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "./supabaseServer";
import { ADMIN_EMAILS } from "./admin-emails";
import {
  generateSessionId,
  needsRollingRotation,
  resolveSessionRollingInterval,
} from "./session-security";
import {
  isBlockedFlag,
  resolveBlockedStatus,
  shouldDenySignIn,
} from "./blocked-user-guard";

const SESSION_ROLLING_INTERVAL_MS = resolveSessionRollingInterval(
  process.env.NEXTAUTH_SESSION_ROLLING_INTERVAL_MINUTES,
);

const SESSION_COOKIE_SECURE =
  process.env.NODE_ENV === "production" ||
  (process.env.NEXTAUTH_URL ?? "").startsWith("https://");

const USER_PROFILE_COLUMNS =
  "id,is_admin,is_dm_admin,avatar_url,name,display_name,is_blocked";
const CREDENTIALS_COLUMNS = `${USER_PROFILE_COLUMNS},email,password_hash`;

const PROFILE_REFRESH_INTERVAL_MS = 60_000; // refresh Supabase profile at most once per minute.
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserProfileRecord = {
  id: string;
  is_admin?: boolean | null;
  is_dm_admin?: boolean | null;
  avatar_url?: string | null;
  name?: string | null;
  display_name?: string | null;
  is_blocked?: boolean | null;
};

function normalizeProfileRecord(
  record?: Partial<UserProfileRecord> | null,
): UserProfileRecord | null {
  if (!record) return null;
  const idValue = record.id ?? (record as any).uid;
  if (!idValue) return null;
  return {
    id: typeof idValue === "string" ? idValue : `${idValue}`,
    is_admin:
      typeof record.is_admin === "boolean" ? record.is_admin : record.is_admin,
    is_dm_admin:
      typeof record.is_dm_admin === "boolean"
        ? record.is_dm_admin
        : record.is_dm_admin,
    avatar_url:
      typeof record.avatar_url === "string" ? record.avatar_url : null,
    name: typeof record.name === "string" ? record.name : null,
    display_name:
      typeof record.display_name === "string" ? record.display_name : null,
    is_blocked:
      typeof record.is_blocked === "boolean" ? record.is_blocked : null,
  };
}

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

async function fetchUserProfileByEmail(
  email: string,
): Promise<UserProfileRecord | null> {
  if (!email) return null;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("users")
      .select(USER_PROFILE_COLUMNS)
      .eq("email", email)
      .maybeSingle();
    return normalizeProfileRecord(data ?? undefined);
  } catch {
    return null;
  }
}

function mintSessionState(now: number) {
  try {
    return {
      sid: generateSessionId(),
      sidIssuedAt: now,
    } as const;
  } catch {
    return { sid: null, sidIssuedAt: null } as const;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
          response_type: "code",
        },
      },
    }),
    GitHub({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
      authorization: { params: { scope: "read:user user:email" } },
    }),
    Credentials({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const emailInput =
          typeof credentials?.email === "string" ? credentials.email : "";
        const password =
          typeof credentials?.password === "string"
            ? credentials.password
            : "";
        const email = emailInput.trim().toLowerCase();

        if (
          !email ||
          !isValidEmail(email) ||
          password.length < MIN_PASSWORD_LENGTH
        ) {
          return null;
        }

        try {
          const sb = supabaseAdmin();
          const { data } = await sb
            .from("users")
            .select(CREDENTIALS_COLUMNS)
            .eq("email", email)
            .maybeSingle();

          if (!data?.password_hash || shouldDenySignIn(data)) {
            return null;
          }

          const valid = await bcrypt.compare(password, data.password_hash);
          if (!valid) return null;

          return {
            id: data.id,
            email: data.email ?? email,
            name: data.display_name ?? data.name ?? data.email ?? email,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  pages: { signIn: "/signin" },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  // Cookie options: do not set Domain to avoid cross-subdomain exposure; Secure only in production
  cookies: {
    sessionToken: {
      name: process.env.NEXTAUTH_COOKIE_NAME || "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: SESSION_COOKIE_SECURE,
      },
    },
  },
  callbacks: {
    async signIn({ user }) {
      try {
        const sb = supabaseAdmin();
        const email = (user.email || "").toLowerCase();
        if (!email) return false;
        const nextAvatarUrl =
          typeof user.image === "string" && user.image.length > 0
            ? user.image
            : null;

        const { data: existing } = await sb
          .from("users")
          .select(USER_PROFILE_COLUMNS)
          .eq("email", email)
          .maybeSingle();

        if (shouldDenySignIn(existing)) {
          return false;
        }

        let profileRecord = normalizeProfileRecord(existing ?? undefined);

        if (!existing) {
          const { data: inserted } = await sb
            .from("users")
            .insert({
              email,
              name: user.name,
              display_name: user.name,
              avatar_url: nextAvatarUrl,
              is_admin: ADMIN_EMAILS.has(email),
            })
            .select(USER_PROFILE_COLUMNS)
            .single();
          profileRecord =
            normalizeProfileRecord(inserted ?? undefined) ?? profileRecord;
        } else {
          const updates: Record<string, unknown> = {};
          if (nextAvatarUrl) {
            updates.avatar_url = nextAvatarUrl;
          }
          if (ADMIN_EMAILS.has(email) && !existing.is_admin) {
            updates.is_admin = true;
          }
          if (Object.keys(updates).length > 0) {
            const { data: updated } = await sb
              .from("users")
              .update(updates)
              .eq("email", email)
              .select(USER_PROFILE_COLUMNS)
              .single();
            profileRecord =
              normalizeProfileRecord(updated ?? undefined) ?? profileRecord;
          }
        }

        if (profileRecord) {
          (user as any).__profile = profileRecord;
        }
      } catch {}
      // On sign-in we want a fresh session identifier (sid) to mitigate fixation.
      const minted = mintSessionState(Date.now());
      if (minted.sid && minted.sidIssuedAt) {
        (user as any).sid = minted.sid;
        (user as any).sidIssuedAt = minted.sidIssuedAt;
      }
      return true;
    },

    async jwt({ token, user }) {
      const now = Date.now();
      const email = (token.email || "").toString().toLowerCase();

      const prevIsAdmin = !!(token as any).is_admin;
      const prevIsDmAdmin = !!(token as any).is_dm_admin;

      let sid =
        typeof (token as any).sid === "string"
          ? ((token as any).sid as string)
          : null;
      let sidIssuedAt =
        typeof (token as any).sidIssuedAt === "number" &&
        Number.isFinite((token as any).sidIssuedAt)
          ? ((token as any).sidIssuedAt as number)
          : null;

      if (user && (user as any).sid) {
        sid = (user as any).sid ?? sid;
        sidIssuedAt = (user as any).sidIssuedAt ?? now;
      } else if (!sid || !sidIssuedAt) {
        const minted = mintSessionState(now);
        if (minted.sid && minted.sidIssuedAt) {
          sid = minted.sid;
          sidIssuedAt = minted.sidIssuedAt;
        }
      }

      if (!email) {
        if (sid) (token as any).sid = sid;
        if (sidIssuedAt) (token as any).sidIssuedAt = sidIssuedAt;
        return token;
      }

      let nextUid = (token as any).uid;
      let nextIsAdmin = prevIsAdmin;
      let nextIsDmAdmin = prevIsDmAdmin;
      let nextAvatarUrl = (token as any).avatar_url ?? null;
      let nextDisplayName =
        (token as any).display_name ?? (token as any).name ?? null;
      let nextIsBlocked = isBlockedFlag((token as any).is_blocked);
      let profileRefreshedAt =
        typeof (token as any).profileRefreshedAt === "number"
          ? ((token as any).profileRefreshedAt as number)
          : 0;

      const profileFromSignIn = normalizeProfileRecord(
        (user as any)?.__profile ?? null,
      );

      const applyProfileRecord = (record: UserProfileRecord | null) => {
        if (!record) return;
        if (record.id) {
          nextUid = record.id;
        }
        if (typeof record.is_admin === "boolean") {
          nextIsAdmin = record.is_admin;
        } else if (!nextIsAdmin) {
          nextIsAdmin = ADMIN_EMAILS.has(email);
        }
        if (typeof record.is_dm_admin === "boolean") {
          nextIsDmAdmin = record.is_dm_admin;
        }
        if (record.avatar_url !== undefined) {
          nextAvatarUrl = record.avatar_url ?? null;
        }
        const candidateDisplay =
          record.display_name ?? record.name ?? nextDisplayName;
        nextDisplayName = candidateDisplay;
        nextIsBlocked = resolveBlockedStatus(nextIsBlocked, record);
      };

      if (profileFromSignIn) {
        applyProfileRecord(profileFromSignIn);
        profileRefreshedAt = now;
      } else if (
        !profileRefreshedAt ||
        now - profileRefreshedAt > PROFILE_REFRESH_INTERVAL_MS
      ) {
        try {
          const sb = supabaseAdmin();
          const { data } = await sb
            .from("users")
            .select(USER_PROFILE_COLUMNS)
            .eq("email", email)
            .maybeSingle();

          if (data) {
            applyProfileRecord(normalizeProfileRecord(data));
          } else {
            nextIsAdmin = ADMIN_EMAILS.has(email);
            nextIsDmAdmin = false;
            nextIsBlocked = false;
          }
          profileRefreshedAt = now;
        } catch {}
      }

      const privilegeElevated =
        (!prevIsAdmin && nextIsAdmin) || (!prevIsDmAdmin && nextIsDmAdmin);

      if (privilegeElevated) {
        const minted = mintSessionState(now);
        if (minted.sid && minted.sidIssuedAt) {
          sid = minted.sid;
          sidIssuedAt = minted.sidIssuedAt;
        }
      }

      if (needsRollingRotation(sidIssuedAt, now, SESSION_ROLLING_INTERVAL_MS)) {
        const minted = mintSessionState(now);
        if (minted.sid && minted.sidIssuedAt) {
          sid = minted.sid;
          sidIssuedAt = minted.sidIssuedAt;
        }
      }

      (token as any).uid = nextUid;
      (token as any).is_admin = nextIsAdmin;
      (token as any).is_dm_admin = nextIsDmAdmin;
      (token as any).avatar_url = nextAvatarUrl;
      (token as any).display_name = nextDisplayName;
      if (sid) (token as any).sid = sid;
      if (sidIssuedAt) (token as any).sidIssuedAt = sidIssuedAt;
      (token as any).is_blocked = nextIsBlocked;
      if (profileRefreshedAt) {
        (token as any).profileRefreshedAt = profileRefreshedAt;
      }
      return token;
    },

    async session({ session, token }) {
      (session.user as any).id = (token as any).uid;
      (session.user as any).is_admin = !!(token as any).is_admin;
      (session.user as any).is_dm_admin = !!(token as any).is_dm_admin;
      const avatarUrl = (token as any).avatar_url ?? null;
      (session.user as any).avatar_url = avatarUrl;
      (session.user as any).image = avatarUrl;
      (session.user as any).display_name =
        (token as any).display_name ?? session.user?.name ?? null;
      (session.user as any).is_blocked = isBlockedFlag(
        (token as any).is_blocked,
      );
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const auth = () => getServerSession(authOptions);

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
