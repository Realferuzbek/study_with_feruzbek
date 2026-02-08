"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Settings, type LucideIcon } from "lucide-react";

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

  return (
    <aside className="flex w-full items-center justify-center gap-4 bg-gradient-to-b from-[#686ff0] to-[#4f59df] px-3 py-3 text-white shadow-[inset_-1px_0_0_rgba(255,255,255,0.12)] md:w-[76px] md:flex-col md:justify-start md:py-6">
      <Link href="/dashboard" aria-label="StudyMate dashboard" title="Dashboard">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#6B5BFF] text-white shadow-[0_10px_18px_rgba(0,0,0,0.2)] transition hover:bg-[#7a6cff]">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M12 4.5c-3.77 0-6.5 2.68-6.5 6.3 0 3.37 2.4 5.81 5.6 6.34v2.2a1 1 0 0 0 2 0v-2.2c3.2-.53 5.6-2.97 5.6-6.34 0-3.62-2.73-6.3-6.7-6.3Z"
              fill="currentColor"
            />
            <circle cx="12" cy="10.8" r="3.1" fill="#6B5BFF" />
          </svg>
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
