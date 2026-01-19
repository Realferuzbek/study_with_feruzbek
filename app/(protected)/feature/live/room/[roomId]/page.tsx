import LiveVoiceRoom from "@/components/live/LiveVoiceRoom";
import { getCachedSession } from "@/lib/server-session";
import AuthRequiredPanel from "@/components/AuthRequiredPanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: { roomId: string };
};

export default async function LiveRoomPage({ params }: PageProps) {
  const session = await getCachedSession();
  const user = session?.user as
    | {
        id?: string;
        display_name?: string | null;
        name?: string | null;
        email?: string | null;
        is_admin?: boolean | null;
      }
    | undefined;

  if (!user?.id) {
    return (
      <div className="min-h-[100dvh] bg-[#07070b] text-white">
        <AuthRequiredPanel
          title="Sign in to join this room"
          description="Live rooms are available after signing in."
          callbackUrl={`/feature/live/room/${params.roomId}`}
        />
      </div>
    );
  }

  return (
    <div className="bg-[#07070b] min-h-[100dvh]">
      <LiveVoiceRoom
        roomId={params.roomId}
        user={{
          id: user.id,
          displayName: user.display_name ?? null,
          name: user.name ?? null,
          email: user.email ?? null,
          isAdmin: user.is_admin ?? false,
        }}
      />
    </div>
  );
}
