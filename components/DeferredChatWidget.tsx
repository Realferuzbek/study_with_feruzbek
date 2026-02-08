"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const ChatWidget = dynamic(() => import("./ChatWidget"), { ssr: false });

type IdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

export default function DeferredChatWidget() {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const hideLauncher =
    pathname?.startsWith("/feature/timer") ||
    pathname === "/feature/live" ||
    pathname === "/feature/live/" ||
    pathname?.startsWith("/feature/live/session/");

  useEffect(() => {
    if (hideLauncher && ready) {
      setReady(false);
    }
  }, [hideLauncher, ready]);

  useEffect(() => {
    if (ready || hideLauncher) return;
    const idleWindow: IdleWindow | null =
      typeof window !== "undefined" ? (window as IdleWindow) : null;

    let timeout: number | null = null;
    let cancelIdle: number | null = null;

    const markReady = () => setReady(true);

    if (idleWindow?.requestIdleCallback) {
      // EFFECT: Hydrates the chat widget only after the browser is idle to protect FCP budget.
      cancelIdle = idleWindow.requestIdleCallback(markReady);
    } else {
      timeout = window.setTimeout(markReady, 900);
    }

    return () => {
      if (cancelIdle && idleWindow?.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(cancelIdle);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [ready, hideLauncher]);

  if (!ready || hideLauncher) return null;
  return <ChatWidget />;
}
