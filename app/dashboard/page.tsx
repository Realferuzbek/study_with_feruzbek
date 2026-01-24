// app/dashboard/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getCachedSession } from "@/lib/server-session";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import dynamicImport from "next/dynamic";
import AvatarBadge from "@/components/AvatarBadge";
import {
  getLanguageOptions,
  getTranslations,
  type FeatureKey,
} from "@/lib/i18n";

// EFFECT: Defers dashboard client-side heartbeat until after first paint to free up FCP.
const UsageHeartbeat = dynamicImport(
  () => import("@/components/UsageHeartbeat"),
  {
    ssr: false,
    loading: () => null,
  },
);
// EFFECT: Lazily hydrates the email bridge so the server hero can stream immediately.
const SessionEmailBridge = dynamicImport(
  () => import("@/components/SessionEmailBridge"),
  {
    ssr: false,
    loading: () => null,
  },
);

export default async function DashboardPage() {
  const session = await getCachedSession();
  const user = session?.user as any;
  const isSignedIn = !!session?.user;
  const avatarSrc = user?.avatar_url ?? user?.image ?? null;
  const displayName = session?.user?.name ?? null;

  const { locale, t } = getTranslations();
  const languageOptions = getLanguageOptions(locale);

  const featureDefinitions: Array<{
    key: FeatureKey;
    accent: string;
    icon: string;
    href?: string;
    isLive?: boolean;
  }> = [
    {
      key: "leaderboard",
      accent: "from-[#a855f7] via-[#6366f1] to-[#22d3ee]",
      icon: "🏆",
      href: "/leaderboard",
      isLive: true,
    },
    {
      key: "chat",
      accent: "from-[#f97316] via-[#fb7185] to-[#a855f7]",
      icon: "💬",
      href: "/community",
    },
    {
      key: "motivation",
      accent: "from-[#22d3ee] via-[#2dd4bf] to-[#a855f7]",
      icon: "⚡",
      isLive: true,
    },
    {
      key: "live",
      accent: "from-[#f472b6] via-[#ec4899] to-[#a855f7]",
      icon: "📺",
      isLive: true,
    },
    {
      key: "tasks",
      accent: "from-[#8b5cf6] via-[#a855f7] to-[#6366f1]",
      icon: "✔️",
      isLive: true,
    },
    {
      key: "timer",
      accent: "from-[#6366f1] via-[#22d3ee] to-[#0ea5e9]",
      icon: "⏱️",
      isLive: true,
    },
    {
      key: "research-positions",
      accent: "from-[#38bdf8] via-[#6366f1] to-[#8b5cf6]",
      icon: "🔬",
    },
    {
      key: "internship-positions",
      accent: "from-[#0ea5e9] via-[#22d3ee] to-[#2dd4bf]",
      icon: "💼",
    },
    {
      key: "essay-workshop",
      accent: "from-[#f97316] via-[#fb7185] to-[#a855f7]",
      icon: "📝",
    },
    {
      key: "universities-emails",
      accent: "from-[#8b5cf6] via-[#a855f7] to-[#6366f1]",
      icon: "📧",
    },
    {
      key: "hobbies-opportunities",
      accent: "from-[#22d3ee] via-[#0ea5e9] to-[#38bdf8]",
      icon: "🎨",
    },
    {
      key: "olympiad-opportunities",
      accent: "from-[#facc15] via-[#f97316] to-[#fb7185]",
      icon: "🏅",
    },
  ];

  const features = featureDefinitions.map((feature) => ({
    ...feature,
    title: t.dashboard.features[feature.key].title,
    description: t.dashboard.features[feature.key].description,
    badge: feature.isLive ? t.common.liveNow : undefined,
  }));

  return (
    <div className="min-h-[100dvh] bg-[#07070b]">
      <SessionEmailBridge email={user?.email ?? null} />
      <Navbar
        isAdmin={!!user?.is_admin}
        avatarUrl={avatarSrc}
        viewerName={displayName}
        viewerEmail={user?.email ?? null}
        isSignedIn={isSignedIn}
        authCallbackUrl="/dashboard"
        locale={locale}
        translations={t.nav}
        languageOptions={languageOptions}
      />

      <main className="mx-auto max-w-6xl px-4 py-8 text-white">
        {isSignedIn ? (
          <section className="mb-10 overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-[#1f1f33] via-[#121225] to-[#0a0a14] p-6 shadow-[0_25px_70px_rgba(104,67,255,0.25)]">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <AvatarBadge
                  avatarUrl={avatarSrc}
                  name={displayName}
                  email={user?.email ?? null}
                  size={64}
                  priority
                  alt="Dashboard avatar"
                />
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-fuchsia-300/70">
                    {t.dashboard.welcomeTag}
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold">
                    {session?.user?.name ?? t.dashboard.welcomeFallback}
                  </h1>
                  <p className="text-sm text-zinc-400">{user?.email}</p>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="mb-10 overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-[#1f1f33] via-[#121225] to-[#0a0a14] p-6 shadow-[0_25px_70px_rgba(104,67,255,0.25)]">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-3xl font-semibold">
                  Welcome to StudyMate
                </h1>
                <p className="mt-2 text-sm text-zinc-300">
                  Browse as guest. Sign in to personalize.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const badgeLabel = feature.badge ?? t.common.comingSoon;
            const badgeClasses = feature.badge
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
              : "border-white/15 text-white/60";

            return (
              <Link
                key={feature.key}
                href={feature.href ?? `/feature/${feature.key}`}
                className="group relative min-h-[160px] overflow-hidden rounded-[26px] border border-white/10 bg-[#0c0c16]/85 p-6 shadow-[0_18px_50px_rgba(12,12,22,0.6)] transition-all duration-200 hover:-translate-y-1 hover:border-white/20"
              >
                <div
                  className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br ${feature.accent} mix-blend-screen`}
                />

                <div className="relative flex items-center justify-between">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-3xl shadow-[0_12px_25px_rgba(0,0,0,0.35)]">
                    <span>{feature.icon}</span>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.3em] ${badgeClasses}`}
                  >
                    {badgeLabel}
                  </span>
                </div>

                <div className="relative mt-6">
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm text-zinc-400">
                    {feature.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </section>

        {isSignedIn ? <UsageHeartbeat /> : null}
      </main>
    </div>
  );
}
