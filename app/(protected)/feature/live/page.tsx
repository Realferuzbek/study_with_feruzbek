import { getCachedSession } from "@/lib/server-session";
import AuthRequiredPanel from "@/components/AuthRequiredPanel";
import LiveStreamStudioShell from "@/components/live/LiveStreamStudioShell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LiveStreamStudioFeature() {
  const session = await getCachedSession();
  const user = session?.user as
    | {
        id?: string;
        display_name?: string | null;
        name?: string | null;
        email?: string | null;
        avatar_url?: string | null;
        image?: string | null;
        is_admin?: boolean | null;
      }
    | undefined;

  if (!user?.id) {
    return (
      <div className="min-h-[100dvh] bg-[#07070b] text-white">
        <AuthRequiredPanel
          title="Sign in to access Live Stream Studio"
          description="Book focus sessions and manage your schedule once you're signed in."
          callbackUrl="/feature/live"
        />
      </div>
    );
  }

  return (
    <LiveStreamStudioShell
      user={{
        id: user.id,
        displayName: user.display_name ?? null,
        name: user.name ?? null,
        email: user.email ?? null,
        avatarUrl: user.avatar_url ?? user.image ?? null,
      }}
    />
  );
}
