export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { DateTime } from "luxon";
import { MOTIVATION_QUOTES, MOTIVATION_COUNT } from "@/data/motivations";
import Navbar from "@/components/Navbar";
import { getCachedSession } from "@/lib/server-session";
import { getLanguageOptions, getTranslations } from "@/lib/i18n";

const TASHKENT_ZONE = "Asia/Tashkent";
const ANCHOR_DATE_ISO = "2025-01-01";

type RotationSnapshot = {
  dateLabel: string;
  quote: string;
  index: number;
};

function computeRotation(target: DateTime): { index: number; cycle: number } {
  const anchor = DateTime.fromISO(ANCHOR_DATE_ISO, {
    zone: TASHKENT_ZONE,
  }).startOf("day");
  const daysOffset = Math.floor(
    target.startOf("day").diff(anchor, "days").days,
  );
  const normalized =
    ((daysOffset % MOTIVATION_COUNT) + MOTIVATION_COUNT) % MOTIVATION_COUNT;
  const cycle = Math.floor(daysOffset / MOTIVATION_COUNT) + 1;
  return { index: normalized, cycle };
}

function buildSnapshot(target: DateTime): RotationSnapshot {
  const { index } = computeRotation(target);
  const quote = MOTIVATION_QUOTES[index];
  const dateLabel = target.toFormat("cccc, d LLLL");
  return { dateLabel, quote, index };
}

export default async function MotivationVaultFeature() {
  const session = await getCachedSession();
  const viewer = session?.user as any;
  const avatarSrc = viewer?.avatar_url ?? viewer?.image ?? null;

  const { locale, t } = getTranslations();
  const languageOptions = getLanguageOptions(locale);

  const now = DateTime.now().setZone(TASHKENT_ZONE);
  const today = buildSnapshot(now);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#05030d] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#3b2a86,transparent_35%),radial-gradient(circle_at_80%_10%,#9e278a,transparent_30%),radial-gradient(circle_at_40%_80%,#0f6a7b,transparent_28%)] opacity-80" />
      <Navbar
        isAdmin={!!viewer?.is_admin}
        avatarUrl={avatarSrc}
        viewerName={viewer?.name ?? null}
        viewerEmail={viewer?.email ?? null}
        locale={locale}
        translations={t.nav}
        languageOptions={languageOptions}
      />

      <main className="relative mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 lg:py-14">
        <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/5 p-7 shadow-[0_30px_90px_rgba(40,18,88,0.35)] backdrop-blur-xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.08),transparent_38%),radial-gradient(circle_at_82%_10%,rgba(255,255,255,0.05),transparent_35%),linear-gradient(140deg,rgba(255,255,255,0.04),transparent_55%)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.45em] text-fuchsia-100/80">
              {t.motivation.todaysMantra}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.35em] text-white/80">
                #{today.index + 1}
              </span>
              <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] uppercase tracking-[0.35em] text-emerald-100">
                Today
              </span>
            </div>
          </div>
          <p className="relative mt-5 text-2xl font-semibold leading-relaxed text-white md:text-[30px]">
            {today.quote}
          </p>
          <div className="relative mt-6 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/65">
            {today.dateLabel}
          </div>
        </section>

        <section className="relative hidden overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-r from-[#0c0f25]/90 to-[#0a0819]/90 p-6 text-sm text-white/75 shadow-[0_18px_55px_rgba(20,12,70,0.35)] sm:block md:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_40%,rgba(255,255,255,0.08),transparent_38%),radial-gradient(circle_at_90%_20%,rgba(255,255,255,0.05),transparent_35%)]" />
          <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-xl font-semibold text-white">
              {t.motivation.useVaultTitle}
            </h3>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.35em] text-white/55">
              Ritual guide
            </span>
          </div>
          <ul className="relative mt-5 grid gap-3 md:grid-cols-3">
            {t.motivation.useVaultTips.map((tip, index) => (
              <li
                key={index}
                className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white/80 shadow-[0_14px_40px_rgba(12,8,40,0.35)]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/80 to-cyan-500/80 text-sm font-semibold text-black/70 shadow-[0_10px_25px_rgba(48,203,166,0.45)]">
                  {index + 1}
                </span>
                <span className="leading-relaxed">{tip}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
