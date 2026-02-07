import type { MetadataRoute } from "next";

const DEFAULT_SITE_URL = "https://thestudymate.vercel.app";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin/",
        "/community/admin/",
        "/leaderboard/admin/",
        "/account/",
        "/auth/",
        "/checkout/",
        "/cart/",
        "/orders/",
        "/feature/live/session/",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
