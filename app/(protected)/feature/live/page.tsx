import LiveRoomsLobby from "@/components/live/LiveRoomsLobby";
import { getCachedSession } from "@/lib/server-session";

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

  const lobbyUser = user?.id
    ? {
        id: user.id,
        displayName: user.display_name ?? null,
        name: user.name ?? null,
        email: user.email ?? null,
        isAdmin: user.is_admin ?? false,
      }
    : {
        id: "guest",
        displayName: "Guest",
        name: "Guest",
        email: null,
        isAdmin: false,
      };

  return (
    <div className="bg-[#07070b] min-h-[100dvh]">
      <LiveRoomsLobby user={lobbyUser} />
    </div>
  );
}
