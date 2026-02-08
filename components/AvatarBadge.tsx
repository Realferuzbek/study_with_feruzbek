import Image from "next/image";
import type { CSSProperties } from "react";
import { getAvatarVisuals } from "@/lib/avatar-colors";

type AvatarBadgeProps = {
  avatarUrl?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
  priority?: boolean;
  alt?: string;
  fallbackMode?: "initial" | "brand";
};

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export default function AvatarBadge({
  avatarUrl,
  name,
  email,
  size = 64,
  className,
  priority = false,
  alt = "User avatar",
  fallbackMode = "initial",
}: AvatarBadgeProps) {
  const { initial } = getAvatarVisuals({ name, email });

  const fontSize = Math.max(16, Math.round(size * 0.45));
  const logoSize = Math.max(16, Math.round(size * 0.58));
  const containerStyle: CSSProperties = {
    width: size,
    height: size,
  };

  const fallbackSurface: CSSProperties = {
    backgroundColor: "rgba(10, 10, 18, 0.85)",
    backgroundImage:
      "radial-gradient(circle at 32% 22%, rgba(255,255,255,0.35), rgba(255,255,255,0) 48%)",
  };

  const brandSurface: CSSProperties = {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    backgroundImage:
      "radial-gradient(circle at 32% 22%, rgba(255,255,255,0.92), rgba(241,245,249,0.88) 52%, rgba(226,232,240,0.88))",
  };

  return (
    <div
      className={cx(
        "relative inline-flex overflow-hidden rounded-full shadow-[0_12px_24px_rgba(0,0,0,0.45)]",
        className,
      )}
      style={containerStyle}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={alt}
          fill
          sizes={`${size}px`}
          priority={priority}
          className="object-cover"
        />
      ) : fallbackMode === "brand" ? (
        <div
          className="flex h-full w-full items-center justify-center"
          style={brandSurface}
        >
          <Image
            src="/logo.svg"
            alt="StudyMate"
            width={logoSize}
            height={logoSize}
            priority={priority}
            className="object-contain"
          />
        </div>
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-white"
          style={{ fontSize, ...fallbackSurface }}
        >
          <span className="font-semibold tracking-tight">{initial}</span>
        </div>
      )}
    </div>
  );
}
