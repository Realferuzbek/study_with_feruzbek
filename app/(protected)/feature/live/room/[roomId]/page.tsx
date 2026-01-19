import LiveVoiceRoom from "@/components/live/LiveVoiceRoom";
import { getCachedSession } from "@/lib/server-session";

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

  const roomUser = user?.id
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
      <LiveVoiceRoom roomId={params.roomId} user={roomUser} />
    </div>
  );
}
