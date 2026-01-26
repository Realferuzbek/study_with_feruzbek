"use client";

import {
  AlertTriangle,
  Loader2,
  MessageCircle,
  Send,
  Settings,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  BROADCAST_AI_TOGGLE_EVENT,
  BROADCAST_CHANNEL_NAME,
} from "@/lib/broadcastChannel";
import { csrfFetch } from "@/lib/csrf-client";
import { supabaseBrowser } from "@/lib/supabaseClient";

type MessageRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: number;
  chatId?: string | null;
  rating?: number | null;
};

type AiStatus = "loading" | "online" | "disabled" | "error";

const suggestionPrompts = [
  "What does the Focus Squad dashboard include?",
  "How do I join a live study session?",
  "What perks come with the premium plan?",
] as const;

const statusTokens: Record<
  AiStatus,
  { text: string; dot: string; pillBg: string; pillText: string }
> = {
  loading: {
    text: "Checking status…",
    dot: "bg-white/50",
    pillBg: "bg-white/5",
    pillText: "text-white/70",
  },
  online: {
    text: "Live",
    dot: "bg-emerald-400",
    pillBg: "bg-emerald-400/10",
    pillText: "text-emerald-200",
  },
  disabled: {
    text: "Paused by admins",
    dot: "bg-amber-400",
    pillBg: "bg-amber-400/10",
    pillText: "text-amber-200",
  },
  error: {
    text: "Status unavailable",
    dot: "bg-rose-400",
    pillBg: "bg-rose-400/10",
    pillText: "text-rose-200",
  },
};

const launcherTokens: Record<
  AiStatus,
  { dot: string; showAlert?: boolean }
> = {
  loading: { dot: "bg-white/40" },
  online: { dot: "bg-emerald-400" },
  disabled: { dot: "bg-amber-400", showAlert: true },
  error: { dot: "bg-rose-400", showAlert: true },
};

const LOCAL_PREF_KEY = "focus-chat-memory-pref";
const TOGGLE_STORAGE_KEY = "focus-ai-toggle";
const TOGGLE_CHANNEL_NAME = "focus-ai-toggle";
const TOGGLE_EVENT = "focus-ai-toggle";
const STATUS_POLL_MS = 10_000;
const MAX_TEXTAREA_HEIGHT = 140;
const SCROLL_BOTTOM_THRESHOLD = 120;

function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>("loading");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [preferenceSupported, setPreferenceSupported] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [hasStoredData, setHasStoredData] = useState(false);
  const [prefLoading, setPrefLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefError, setPrefError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const list = listRef.current;
      if (!list) return;
      list.scrollTo({ top: list.scrollHeight, behavior });
    },
    [],
  );

  const handleListScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    autoScrollRef.current = distance < SCROLL_BOTTOM_THRESHOLD;
  }, []);

  const resizeTextarea = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    const nextHeight = Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY =
      element.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    if (autoScrollRef.current) {
      scrollToBottom("auto");
    }
  }, [scrollToBottom]);

  useEffect(() => {
    if (!open) return;
    autoScrollRef.current = true;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [open, scrollToBottom]);

  useEffect(() => {
    if (!open) return;
    if (autoScrollRef.current) {
      scrollToBottom("smooth");
    }
  }, [messages, sending, open, scrollToBottom]);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(resizeTextarea);
  }, [open, resizeTextarea]);

  useEffect(() => {
    if (!open) {
      setSettingsOpen(false);
    }
  }, [open]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("focus-chat-session");
      if (stored && isUuid(stored)) {
        setSessionId(stored);
        return;
      }
      const minted = crypto.randomUUID();
      window.localStorage.setItem("focus-chat-session", minted);
      setSessionId(minted);
    } catch {
      const fallback = crypto.randomUUID();
      setSessionId(fallback);
    }
  }, []);

  const refreshStatus = useCallback(async (): Promise<AiStatus> => {
    setStatusError(null);
    try {
      const res = await fetch("/api/chat/status", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      const liveFlag =
        typeof body?.live === "boolean"
          ? body.live
          : typeof body?.enabled === "boolean"
            ? body.enabled
            : null;
      if (!res.ok || typeof liveFlag !== "boolean") {
        throw new Error(body?.error || "status unavailable");
      }
      const nextStatus: AiStatus = liveFlag ? "online" : "disabled";
      setAiStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      setAiStatus("error");
      setStatusError(
        error instanceof Error ? error.message : "Unable to reach assistant.",
      );
      return "error";
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!open) return;
    refreshStatus();
  }, [open, refreshStatus]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshStatus();
      }
    };
    const handleFocus = () => refreshStatus();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleFocus);
    };
  }, [refreshStatus]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshStatus();
      }
    }, STATUS_POLL_MS);
    return () => window.clearInterval(interval);
  }, [refreshStatus]);

  const applyToggleSignal = useCallback((enabled: boolean) => {
    setStatusError(null);
    setAiStatus(enabled ? "online" : "disabled");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TOGGLE_STORAGE_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue);
        if (typeof payload?.enabled === "boolean") {
          applyToggleSignal(payload.enabled);
        }
      } catch {
        // ignore malformed payloads
      }
    };

    const handleCustomEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>)?.detail;
      if (typeof detail?.enabled === "boolean") {
        applyToggleSignal(detail.enabled);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(TOGGLE_EVENT, handleCustomEvent as EventListener);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(TOGGLE_CHANNEL_NAME);
      channel.onmessage = (event) => {
        const data = event?.data;
        if (typeof data?.enabled === "boolean") {
          applyToggleSignal(data.enabled);
        }
      };
    }

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        TOGGLE_EVENT,
        handleCustomEvent as EventListener,
      );
      channel?.close();
    };
  }, [applyToggleSignal]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const channel = supabaseBrowser.channel(BROADCAST_CHANNEL_NAME);
    channel.on(
      "broadcast",
      { event: BROADCAST_AI_TOGGLE_EVENT },
      ({ payload }) => {
        const enabled = (payload as { enabled?: boolean } | null | undefined)
          ?.enabled;
        if (typeof enabled === "boolean") {
          applyToggleSignal(enabled);
        }
      },
    );
    channel.subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [applyToggleSignal]);

  const loadPreferences = useCallback(async () => {
    setPrefLoading(true);
    setPrefError(null);
    try {
      const res = await fetch("/api/chat/preferences", {
        cache: "no-store",
      });
      if (res.status === 401) {
        const localOptOut =
          window.localStorage.getItem(LOCAL_PREF_KEY) === "0";
        setMemoryEnabled(!localOptOut);
        setPreferenceSupported(false);
        setHasStoredData(false);
        setUserId(null);
        return;
      }
      if (!res.ok) {
        throw new Error("Unable to load data settings");
      }
      const body = await res.json();
      setUserId(body.userId ?? null);
      setMemoryEnabled(body.memoryEnabled);
      setHasStoredData(Boolean(body.hasData));
      setPreferenceSupported(true);
    } catch (error) {
      setPreferenceSupported(false);
      setPrefError(
        error instanceof Error ? error.message : "Failed to load settings",
      );
    } finally {
      setPrefLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const composerDisabled =
    sending ||
    !sessionId ||
    aiStatus === "disabled" ||
    aiStatus === "error" ||
    aiStatus === "loading";

  const placeholder = useMemo(() => {
    if (aiStatus === "disabled") {
      return "Assistant paused by admins";
    }
    if (aiStatus === "error") {
      return "Assistant unavailable";
    }
    return "Ask anything about this site…";
  }, [aiStatus]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !sessionId || composerDisabled) return;
    const currentStatus = await refreshStatus();
    if (currentStatus !== "online") return;
    const now = Date.now();
    const userMessage: ChatMessage = {
      id: `user-${now}`,
      role: "user",
      text: input.trim(),
      timestamp: now,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);
    try {
      const res = await csrfFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: userMessage.text,
          sessionId,
          userId: userId ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503) {
        const pauseText =
          typeof body?.text === "string" && body.text.length
            ? body.text
            : "The assistant is paused right now. Check back soon!";
        setAiStatus("disabled");
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            text: pauseText,
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      if (!res.ok || !body?.text) {
        throw new Error(body?.error || "Assistant unavailable");
      }
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: body.text,
        timestamp: Date.now(),
        chatId: body.chatId ?? null,
        rating: null,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (typeof body.language === "string" && body.language.length) {
        window.sessionStorage.setItem("focus-chat-language", body.language);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: formatError(
            error instanceof Error ? error.message : String(error),
          ),
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sessionId, composerDisabled, userId, refreshStatus]);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const selectSuggestion = (value: string) => {
    setInput(value);
    setOpen(true);
  };

  const updateRating = async (
    messageId: string,
    chatId: string | null | undefined,
    rating: number,
  ) => {
    if (!chatId || !sessionId) return;
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, rating } : msg,
      ),
    );
    try {
      await csrfFetch("/api/chat/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, sessionId, rating }),
      });
    } catch {
      // Ignore rating errors
    }
  };

  const toggleMemory = async () => {
    if (prefLoading) return;
    const nextValue = !memoryEnabled;
    setMemoryEnabled(nextValue);
    if (!preferenceSupported || !userId) {
      window.localStorage.setItem(LOCAL_PREF_KEY, nextValue ? "1" : "0");
      return;
    }
    try {
      const res = await csrfFetch("/api/chat/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryEnabled: nextValue }),
      });
      if (!res.ok) throw new Error("Failed to update preference");
    } catch (error) {
      setMemoryEnabled(!nextValue);
      setPrefError(
        error instanceof Error ? error.message : "Update failed",
      );
    }
  };

  const forgetData = async () => {
    if (!preferenceSupported || !userId) return;
    const confirmed = window.confirm(
      "Delete your stored Focus Squad AI data? This removes chat logs and memories from the last 90 days.",
    );
    if (!confirmed) return;
    try {
      const res = await csrfFetch("/api/chat/preferences", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Unable to delete data");
      setHasStoredData(false);
    } catch (error) {
      setPrefError(
        error instanceof Error ? error.message : "Deletion failed",
      );
    }
  };

  const settingsPanel =
    settingsOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
            <button
              type="button"
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close settings"
            />
            <div
              role="dialog"
              aria-modal="true"
              className="relative w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-hidden rounded-3xl border border-white/10 bg-[#090a16]/95 backdrop-blur-xl shadow-[0_40px_120px_rgba(3,5,22,0.85)]"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                    Data settings
                  </p>
                  <p className="text-lg font-semibold text-white">
                    Personalization
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="max-h-[70dvh] overflow-y-auto px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] text-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-white">
                      Use my messages to improve answers
                    </p>
                    <p className="text-xs text-white/60">
                      {preferenceSupported
                        ? "Keep personalized context so replies stay relevant."
                        : "Sign in to manage AI data preferences."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleMemory}
                    disabled={prefLoading}
                    className={`flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                      memoryEnabled ? "bg-emerald-400/80" : "bg-white/20"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                        memoryEnabled ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
                {prefError && (
                  <p className="mt-2 text-xs text-rose-300">{prefError}</p>
                )}
                {preferenceSupported && (
                  <button
                    type="button"
                    onClick={forgetData}
                    disabled={!hasStoredData}
                    className="mt-3 inline-flex items-center gap-2 text-xs text-white/60 hover:text-white disabled:opacity-30"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Forget my data
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="fixed bottom-6 right-6 z-40 text-white">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-3 rounded-full bg-[linear-gradient(135deg,#7C3AED,#22D3EE)] px-5 py-3 text-left shadow-[0_18px_35px_rgba(34,211,238,0.35)] transition hover:scale-105 focus-visible:outline-none"
      >
        <div className={`h-2 w-2 rounded-full ${launcherTokens[aiStatus].dot}`} />
        <div>
          <p className="text-sm font-semibold leading-none">Ask AI</p>
          <p className="text-xs text-white/80">Always-on focus buddy</p>
        </div>
        {launcherTokens[aiStatus].showAlert && (
          <AlertTriangle className="h-4 w-4 text-amber-200" />
        )}
      </button>

      {open && (
        <div className="mt-4 flex h-[520px] w-[360px] max-w-[calc(100vw-2rem)] min-h-[360px] max-h-[80dvh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#090a16]/95 backdrop-blur-xl shadow-[0_40px_120px_rgba(3,5,22,0.85)]">
          <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-4">
            <div>
              <p className="text-lg font-semibold">Focus Squad AI</p>
              <div
                className={`mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${statusTokens[aiStatus].pillBg} ${statusTokens[aiStatus].pillText}`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${statusTokens[aiStatus].dot}`}
                />
                {statusTokens[aiStatus].text}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen((prev) => !prev)}
                className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"
                aria-label="Data settings"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pr-6 py-4 hide-scrollbar scroll-smooth"
            onScroll={handleListScroll}
            ref={listRef}
          >
            {statusError && (
              <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                {statusError}
              </div>
            )}
            {aiStatus === "disabled" && (
              <div className="ai-system-banner mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-amber-100">
                <p className="text-sm font-semibold">Assistant paused</p>
                <p className="mt-1 text-xs text-amber-100/80">
                  Admins paused replies for now. You can still read this thread.
                  Check back soon.
                </p>
              </div>
            )}
            {!messages.length && aiStatus === "online" && (
              <div className="mb-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                  Try asking
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestionPrompts.map((prompt) => (
                    <button
                      type="button"
                      key={prompt}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 transition hover:bg-white/10"
                      onClick={() => selectSuggestion(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div
                    key={message.id}
                    className={`flex flex-col ${
                      isUser ? "items-end text-right" : "items-start text-left"
                    }`}
                  >
                    <span className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                      {isUser ? "You" : "Assistant"}
                    </span>
                    <div
                      className={`mt-1 rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        isUser
                          ? "bg-[linear-gradient(135deg,#7C3AED,#22D3EE)] text-white shadow-[0_18px_35px_rgba(34,211,238,0.35)]"
                          : "border border-white/10 bg-white/5 text-white/90"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {message.text}
                      </p>
                      {!isUser && message.chatId && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
                          <span>Was this helpful?</span>
                          <button
                            type="button"
                            onClick={() =>
                              updateRating(message.id, message.chatId, 1)
                            }
                            disabled={typeof message.rating === "number"}
                            className={`rounded-full border px-2 py-1 ${
                              message.rating === 1
                                ? "border-emerald-300 text-emerald-200"
                                : "border-white/10 text-white/70 hover:border-white/30"
                            }`}
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateRating(message.id, message.chatId, -1)
                            }
                            disabled={typeof message.rating === "number"}
                            className={`rounded-full border px-2 py-1 ${
                              message.rating === -1
                                ? "border-rose-300 text-rose-200"
                                : "border-white/10 text-white/70 hover:border-white/30"
                            }`}
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <span className="mt-1 text-[11px] text-white/50">
                      {formatTimestamp(message.timestamp)}
                    </span>
                  </div>
                );
              })}

              {sending && (
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                  <Sparkles className="h-4 w-4 animate-pulse text-cyan-200" />
                  Thinking…
                </div>
              )}
            </div>
          </div>

          <footer className="shrink-0 space-y-2 border-t border-white/5 px-5 py-4">
            <div className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={placeholder}
                rows={1}
                className="hide-scrollbar max-h-[140px] flex-1 resize-none overflow-y-hidden bg-transparent text-sm leading-relaxed text-white placeholder:text-white/50 focus:outline-none disabled:opacity-60 whitespace-pre-wrap break-words"
                disabled={composerDisabled}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={composerDisabled || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#7C3AED,#22D3EE)] text-white shadow-[0_18px_35px_rgba(34,211,238,0.35)] transition hover:scale-105 disabled:opacity-40 disabled:shadow-none"
                aria-label="Send message"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 -rotate-[30deg]" />
                )}
              </button>
            </div>
            <p className="text-center text-[10px] text-white/50">
              Answers stay site-specific. Double-check important details.
            </p>
          </footer>
        </div>
      )}
      {settingsPanel}
    </div>
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function formatError(message: string) {
  if (/unauthorized/i.test(message)) {
    return "I need a quick break—try again in a moment.";
  }
  if (/disabled/i.test(message)) {
    return "The assistant is paused right now. Check back soon!";
  }
  return "I ran into a hiccup. Ask me again in a few seconds!";
}
