export default function DashboardLoading() {
  return (
    <div className="min-h-[100dvh] bg-[#07070b]">
      <div className="mx-auto max-w-6xl px-4 py-8 text-white">
        <div className="mb-10 animate-pulse overflow-hidden rounded-[32px] border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-white/10" />
              <div className="space-y-2">
                <div className="h-3 w-32 rounded bg-white/10" />
                <div className="h-4 w-48 rounded bg-white/20" />
                <div className="h-3 w-40 rounded bg-white/10" />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="h-10 w-32 rounded-2xl border border-white/20 bg-white/5" />
              <div className="h-10 w-32 rounded-2xl bg-gradient-to-r from-[#8b5cf6]/40 via-[#a855f7]/40 to-[#ec4899]/40" />
            </div>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="animate-pulse rounded-[26px] border border-white/10 bg-white/5 p-6"
            >
              <div className="flex items-center justify-between">
                <div className="h-12 w-12 rounded-2xl bg-white/10" />
                <div className="h-4 w-20 rounded bg-white/10" />
              </div>
              <div className="mt-6 space-y-3">
                <div className="h-4 w-3/4 rounded bg-white/20" />
                <div className="h-3 w-full rounded bg-white/10" />
                <div className="h-3 w-5/6 rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
