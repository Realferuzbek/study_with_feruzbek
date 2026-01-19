// app/(protected)/layout.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { ReactNode } from "react";

export default function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
