import AuthEntryButtons from "@/components/AuthEntryButtons";

type AuthRequiredPanelProps = {
  title: string;
  description: string;
  callbackUrl: string;
};

export default function AuthRequiredPanel({
  title,
  description,
  callbackUrl,
}: AuthRequiredPanelProps) {
  return (
    <div className="min-h-[70dvh] grid place-items-center px-4 py-12 text-white">
      <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-white/5 p-8 text-center shadow-[0_25px_70px_rgba(0,0,0,0.4)]">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-white/70">{description}</p>
        <AuthEntryButtons
          callbackUrl={callbackUrl}
          className="mt-6 flex w-full flex-col items-stretch gap-3 sm:flex-row sm:justify-center"
        />
      </div>
    </div>
  );
}
