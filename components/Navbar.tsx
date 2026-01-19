// components/Navbar.tsx
import Image from "next/image";
import Link from "next/link";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import AvatarMenu from "@/components/AvatarMenu";
import AuthEntryButtons from "@/components/AuthEntryButtons";
import type { LanguageOption, Locale } from "@/lib/i18n";

type NavbarProps = {
  isAdmin?: boolean;
  avatarUrl?: string | null;
  viewerName?: string | null;
  viewerEmail?: string | null;
  isSignedIn?: boolean;
  authCallbackUrl?: string;
  locale: Locale;
  translations: {
    reviewerPanel: string;
    switchAccount: string;
    deleteAccount: string;
    deleteAccountConfirm: string;
    languageMenuLabel: string;
  };
  languageOptions: LanguageOption[];
};

export default function Navbar({
  isAdmin = false,
  avatarUrl,
  viewerName,
  viewerEmail,
  isSignedIn,
  authCallbackUrl,
  locale,
  translations,
  languageOptions,
}: NavbarProps) {
  const signedIn =
    isSignedIn ?? Boolean(viewerEmail || viewerName || avatarUrl);
  const callbackUrl = authCallbackUrl ?? "/dashboard";

  return (
    <header className="w-full border-b border-white/10 bg-black/30 backdrop-blur-xl supports-[backdrop-filter]:bg-black/20">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 text-white">
        <Link href="/dashboard" className="flex items-center gap-3">
          <Image src="/logo.svg" alt="logo" width={30} height={30} />
          <span className="text-lg font-semibold tracking-tight">StudyMate</span>
        </Link>

        <nav className="relative flex items-center gap-4">
          {isAdmin && (
            <Link
              href="/admin"
              className="btn-primary px-5 opacity-90 hover:opacity-100"
            >
              {translations.reviewerPanel}
            </Link>
          )}

          <LanguageSwitcher
            locale={locale}
            options={languageOptions}
            label={translations.languageMenuLabel}
          />

          {signedIn ? (
            <AvatarMenu
              avatarUrl={avatarUrl}
              name={viewerName}
              email={viewerEmail}
              switchAccountLabel={translations.switchAccount}
              deleteAccountLabel={translations.deleteAccount}
              deleteAccountConfirm={translations.deleteAccountConfirm}
            />
          ) : (
            <>
              <AuthEntryButtons
                callbackUrl={callbackUrl}
                size="md"
                className="hidden items-center gap-3 sm:flex"
              />
              <AuthEntryButtons
                callbackUrl={callbackUrl}
                size="sm"
                className="flex items-center gap-2 sm:hidden"
              />
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
