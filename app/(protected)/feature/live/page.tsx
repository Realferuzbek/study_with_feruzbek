import LiveRoomsLobby from "@/components/live/LiveRoomsLobby";
import { getCachedSession } from "@/lib/server-session";
import AuthRequiredPanel from "@/components/AuthRequiredPanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LiveRoomsFeature() {
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
          title="Sign in to join live rooms"
          description="Browse live rooms and join the conversation once you're signed in."
          callbackUrl="/feature/live"
        />
      </div>
    );
  }

  return (
    <div className="bg-[#07070b] min-h-[100dvh]">
      <LiveRoomsLobby
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
