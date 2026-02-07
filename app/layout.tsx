import "./globals.css";
import type { Metadata, Viewport } from "next";
import NextTopLoader from "nextjs-toploader";
import type { ReactNode } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
// EFFECT: Defers the AI chat widget until idle so above-the-fold paint stays fast.
import DeferredChatWidget from "@/components/DeferredChatWidget";
import { inter } from "@/app/fonts";
import Providers from "./providers";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://thestudymate.vercel.app";
const ENABLE_TELEMETRY = (process.env.ENABLE_TELEMETRY ?? "0").trim() === "1";
const SITE_TITLE = "StudyMate";
const SITE_DESCRIPTION =
  "Study tracker, timers, streaks & productivity tools by StudyMate.";
function sanitizeGoogleVerification(raw?: string | null) {
  if (!raw) return null;
  const trimmed = raw.trim();
  const contentMatch = trimmed.match(/content=["']?([^"'>\s]+)["']?/i);
  if (contentMatch) return contentMatch[1];
  if (trimmed.startsWith("<meta")) {
    const fallbackMatch = trimmed.match(/["']([^"']+)["']/);
    if (fallbackMatch) return fallbackMatch[1];
    return null;
  }
  return trimmed.replace(/<[^>]+>/g, "").trim() || null;
}

const GOOGLE_SITE_VERIFICATION =
  sanitizeGoogleVerification(
    process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
  ) || "0o6FVChUObGWIeZwtJr98EohQyDziejqoVX9TyxAQcc";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | StudyMate",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "StudyMate",
    "Focus Squad",
    "coworking",
    "productivity",
    "study with me",
    "community",
  ],
  authors: [{ name: SITE_TITLE }],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_TITLE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/logo.svg",
        width: 512,
        height: 512,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/logo.svg"],
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/icon-192.png" }],
    shortcut: ["/logo.svg"],
  },
  manifest: "/manifest.json",
  robots: { index: true, follow: true },
  verification: {
    google: GOOGLE_SITE_VERIFICATION,
  },
};

export const viewport: Viewport = {
  themeColor: "#07070b",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} font-sans`}>
      <head>
        <meta
          name="google-site-verification"
          content={GOOGLE_SITE_VERIFICATION}
        />
      </head>
      <body className="font-sans bg-[#07070b] text-white">
        <Providers>
          <NextTopLoader showSpinner={false} />
          <ServiceWorkerRegister />
          {children}
          {ENABLE_TELEMETRY ? (
            <>
              <Analytics />
              <SpeedInsights />
            </>
          ) : null}
          <DeferredChatWidget />
        </Providers>
      </body>
    </html>
  );
}
