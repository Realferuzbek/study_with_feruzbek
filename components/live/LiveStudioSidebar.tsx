"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleDot, Home, Settings } from "lucide-react";

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
  icon: typeof CircleDot;
  isBottom?: boolean;
};

const navItems: NavItem[] = [
  { label: "Studio", href: "/feature/live", icon: CircleDot },
  { label: "Home", href: "/dashboard", icon: Home },
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
      <nav className="flex items-center gap-3 md:flex-col md:gap-5">
        {navItems.map((item) => {
          const isActive = item.href ? pathname === item.href : false;
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
