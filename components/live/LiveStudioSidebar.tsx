"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Settings, User } from "lucide-react";

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
  icon: typeof Home;
  isBottom?: boolean;
};

const navItems: NavItem[] = [
  { label: "Home", href: "/feature/live", icon: Home },
  { label: "Settings", icon: Settings },
];

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function initialsFromUser(name?: string | null, email?: string | null) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase());
    return letters.join("") || "U";
  }
  if (email) {
    return email.trim().slice(0, 1).toUpperCase() || "U";
  }
  return "U";
}

export default function LiveStudioSidebar({ user }: LiveStudioSidebarProps) {
  const pathname = usePathname();
  const profileInitials = initialsFromUser(user?.name, user?.email);

  return (
    <aside className="flex w-full items-center justify-between gap-4 bg-[var(--studio-sidebar)] px-3 py-3 text-white shadow-[inset_-1px_0_0_rgba(255,255,255,0.12)] md:w-16 md:flex-col md:justify-start md:gap-5 md:py-6">
      <Link
        href="/dashboard"
        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 p-2 shadow-[0_10px_20px_rgba(0,0,0,0.18)]"
        aria-label="StudyMate dashboard"
      >
        <Image src="/logo.svg" alt="StudyMate logo" width={28} height={28} />
      </Link>

      <nav className="flex flex-1 items-center gap-3 md:flex-col md:gap-4">
        {navItems.map((item) => {
          const isActive = item.href ? pathname === item.href : false;
          const Icon = item.icon;
          const content = (
            <span
              className={cx(
                "flex h-11 w-11 items-center justify-center rounded-2xl transition",
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

      <div className="hidden md:block">
        <button
          type="button"
          aria-label="Profile"
          title="Profile"
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 shadow-[0_10px_18px_rgba(0,0,0,0.2)]"
        >
          {user?.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt="Profile avatar"
              width={34}
              height={34}
              className="rounded-xl object-cover"
            />
          ) : (
            <span className="text-sm font-semibold">{profileInitials}</span>
          )}
        </button>
      </div>

      <div className="flex md:hidden">
        <button
          type="button"
          aria-label="Profile"
          title="Profile"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15"
        >
          <User className="h-5 w-5" />
        </button>
      </div>
    </aside>
  );
}
