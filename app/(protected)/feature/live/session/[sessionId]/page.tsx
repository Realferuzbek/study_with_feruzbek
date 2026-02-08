import FocusmateSessionRoom from "@/components/live/FocusmateSessionRoom";
import AuthRequiredPanel from "@/components/AuthRequiredPanel";
import { getCachedSession } from "@/lib/server-session";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: { sessionId: string };
};

export default async function FocusSessionPage({ params }: PageProps) {
  const session = await getCachedSession();
  const user = session?.user as
    | {
        id?: string;
        display_name?: string | null;
        name?: string | null;
        email?: string | null;
      }
    | undefined;

  if (!user?.id) {
    return (
      <div className="min-h-[100dvh] bg-[#07070b] text-white">
        <AuthRequiredPanel
          title="Sign in to join this session"
          description="Focus sessions are available after signing in."
          callbackUrl={`/feature/live/session/${params.sessionId}`}
        />
      </div>
    );
  }

  let sessionMeta:
    | { startAt?: string | null; endAt?: string | null; status?: string | null }
    | undefined;

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("focus_sessions")
      .select("start_at, end_at, duration_minutes, status")
      .eq("id", params.sessionId)
      .maybeSingle();

    if (error) {
      console.error("[focus session page] metadata lookup failed", error);
    } else if (data?.start_at) {
      const start = new Date(data.start_at);
      if (!Number.isNaN(start.valueOf())) {
        const explicitEnd = data.end_at ? new Date(data.end_at) : null;
        const durationMinutes = Number.isFinite(data.duration_minutes)
          ? Number(data.duration_minutes)
          : 0;
        const computedEnd = new Date(start.getTime() + durationMinutes * 60_000);
        const resolvedEnd =
          explicitEnd && !Number.isNaN(explicitEnd.valueOf())
            ? explicitEnd
            : computedEnd;
        sessionMeta = {
          startAt: start.toISOString(),
          endAt: Number.isNaN(resolvedEnd.valueOf())
            ? null
            : resolvedEnd.toISOString(),
          status:
            typeof data.status === "string" ? data.status.toLowerCase() : null,
        };
      }
    }
  } catch (error) {
    console.error("[focus session page] metadata lookup errored", error);
  }

  return (
    <div className="min-h-[100dvh] bg-[#07070b] text-white">
      <FocusmateSessionRoom
        sessionId={params.sessionId}
        session={sessionMeta}
        user={{
          id: user.id,
          displayName: user.display_name ?? null,
          name: user.name ?? null,
          email: user.email ?? null,
        }}
      />
    </div>
  );
}
