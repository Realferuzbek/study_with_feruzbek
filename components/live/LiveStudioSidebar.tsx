"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Settings, type LucideIcon } from "lucide-react";
import { useState } from "react";

type LiveStudioSidebarProps = {
  user?: {
    name?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
  };
};

type NavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  isBottom?: boolean;
};

const navItems: NavItem[] = [
  { label: "Home", href: "/feature/live", icon: Home },
  { label: "Settings", icon: Settings },
];

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function LiveStudioSidebar({
  user: _user,
}: LiveStudioSidebarProps) {
  const pathname = usePathname();
  const [isLogoUnavailable, setIsLogoUnavailable] = useState(false);

  return (
    <aside className="flex w-full items-center justify-center gap-4 bg-gradient-to-b from-[#686ff0] to-[#4f59df] px-3 py-3 text-white shadow-[inset_-1px_0_0_rgba(255,255,255,0.12)] md:w-[76px] md:flex-col md:justify-start md:py-6">
      <Link href="/dashboard" aria-label="StudyMate dashboard" title="Dashboard">
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white/95 text-[#4f59df] shadow-[0_10px_18px_rgba(0,0,0,0.2)]">
          {isLogoUnavailable ? (
            <span className="text-[11px] font-semibold tracking-[0.08em]">
              SM
            </span>
          ) : (
            <Image
              src="/logo.svg"
              alt="StudyMate"
              width={28}
              height={28}
              className="h-7 w-7 object-contain"
              onError={() => setIsLogoUnavailable(true)}
            />
          )}
        </span>
      </Link>

      <nav className="flex items-center gap-3 md:flex-col md:gap-5">
        {navItems.map((item) => {
          const isActive = item.href
            ? item.href === "/feature/live"
              ? pathname.startsWith("/feature/live")
              : pathname === item.href
            : false;
          const Icon = item.icon;
          const content = (
            <span
              className={cx(
                "flex h-11 w-11 items-center justify-center rounded-full transition",
                isActive
                  ? "bg-white/20 shadow-[0_10px_18px_rgba(0,0,0,0.2)]"
                  : "hover:bg-white/10",
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
          );

          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              aria-label={item.label}
              title={item.label}
            >
              {content}
            </Link>
          ) : (
            <button
              key={item.label}
              type="button"
              aria-label={item.label}
              title={item.label}
            >
              {content}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
