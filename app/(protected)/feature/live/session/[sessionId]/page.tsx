import FocusmateSessionRoom from "@/components/live/FocusmateSessionRoom";
import AuthRequiredPanel from "@/components/AuthRequiredPanel";
import { getCachedSession } from "@/lib/server-session";

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

  return (
    <div className="min-h-[100dvh] bg-[#07070b] text-white">
      <FocusmateSessionRoom
        sessionId={params.sessionId}
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
