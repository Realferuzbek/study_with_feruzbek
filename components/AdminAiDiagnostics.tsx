"use client";

import { useCallback, useEffect, useState } from "react";

type DiagnosticsPayload = {
  openai: {
    apiKeyPresent: boolean;
    genModel: string;
    embedModel: string;
    useMockAi: boolean;
  };
  upstash: {
    urlPresent: boolean;
    tokenPresent: boolean;
    indexName: string;
    vectorDim: number | null;
  };
  ragEnv: {
    siteBaseUrlPresent: boolean;
    indexerSecretPresent: boolean;
    upstashUrlPresent: boolean;
    upstashTokenPresent: boolean;
    openaiKeyPresent: boolean;
  };
  supabase: {
    serverHost: string | null;
    publicHost: string | null;
    mismatch: boolean;
    serverSource: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | null;
  };
  indexing: {
    mode: "supabase" | "memory" | "disabled";
    lastError?: string;
    lastReindexedAt?: string | null;
  };
  localDocs: {
    files: number;
    chunks: number;
  };
  featureFlags: {
    aiChatEnabled: boolean;
  };
  runtime: {
    nodeEnv: string | null;
    vercelEnv: string | null;
  };
  timestamp: string;
};

type ApiResponse = { diagnostics?: DiagnosticsPayload; error?: string };

function formatTimestamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
        ok
          ? "border-emerald-400/30 text-emerald-200"
          : "border-rose-400/40 text-rose-200"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-300" : "bg-rose-300"}`}
      />
      {label}
    </span>
  );
}

export default function AdminAiDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-diagnostics", {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok) {
        throw new Error(body?.error || "Unable to load AI diagnostics");
      }
      setDiagnostics(body?.diagnostics ?? null);
    } catch (err) {
      setDiagnostics(null);
      setError(
        err instanceof Error ? err.message : "Unable to load AI diagnostics",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const lastUpdated = formatTimestamp(diagnostics?.timestamp);
  const lastReindex = formatTimestamp(diagnostics?.indexing?.lastReindexedAt);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0f0f18]/90 p-6 shadow-[0_18px_45px_-24px_rgba(140,122,245,0.35)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-white/45">
            Ask AI diagnostics
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Connection health
          </h2>
          <p className="text-sm text-white/60">
            Verify that OpenAI, Upstash Vector, and the AI toggle are configured
            correctly.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-full border border-white/15 px-5 py-2 text-sm font-semibold text-white transition hover:border-white/40 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh diagnostics"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

      {diagnostics && (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                  OpenAI
                </h3>
                <StatusBadge
                  ok={
                    diagnostics.openai.apiKeyPresent &&
                    !diagnostics.openai.useMockAi
                  }
                  label={diagnostics.openai.useMockAi ? "Mock mode" : "Live"}
                />
              </div>
              <dl className="mt-4 space-y-2 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">API key</dt>
                  <dd>
                    {diagnostics.openai.apiKeyPresent ? "Detected" : "Missing"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Gen model</dt>
                  <dd className="text-white">{diagnostics.openai.genModel}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Embed model</dt>
                  <dd className="text-white">
                    {diagnostics.openai.embedModel}
                  </dd>
                </div>
              </dl>
              {diagnostics.openai.useMockAi && (
                <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                  Mock mode is ON. Disable the{" "}
                  <code className="text-amber-200">USE_MOCK_AI</code> toggle (or
                  provide a real OpenAI key) to deliver live answers.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                  Upstash Vector
                </h3>
                <StatusBadge
                  ok={
                    diagnostics.upstash.urlPresent &&
                    diagnostics.upstash.tokenPresent
                  }
                  label={
                    diagnostics.upstash.urlPresent &&
                    diagnostics.upstash.tokenPresent
                      ? "Connected"
                      : "Missing"
                  }
                />
              </div>
              <dl className="mt-4 space-y-2 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">REST URL</dt>
                  <dd>
                    {diagnostics.upstash.urlPresent ? "Detected" : "Missing"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">REST token</dt>
                  <dd>
                    {diagnostics.upstash.tokenPresent ? "Detected" : "Missing"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Index name</dt>
                  <dd className="text-white">
                    {diagnostics.upstash.indexName}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Vector dim</dt>
                  <dd className="text-white">
                    {diagnostics.upstash.vectorDim ?? "—"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                Feature flag
              </h3>
              <div className="mt-3 flex items-center gap-3">
                <StatusBadge
                  ok={diagnostics.featureFlags.aiChatEnabled}
                  label={
                    diagnostics.featureFlags.aiChatEnabled
                      ? "Assistant live"
                      : "Assistant paused"
                  }
                />
                <p className="text-sm text-white/70">
                  {diagnostics.featureFlags.aiChatEnabled
                    ? "Users can reach the chatbot."
                    : "Chatbot requests are blocked."}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                Runtime
              </h3>
              <dl className="mt-3 space-y-2 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">NODE_ENV</dt>
                  <dd className="text-white">
                    {diagnostics.runtime.nodeEnv ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Vercel env</dt>
                  <dd className="text-white">
                    {diagnostics.runtime.vercelEnv ?? "—"}
                  </dd>
                </div>
                {lastUpdated && (
                  <div className="flex items-center justify-between">
                    <dt className="text-white/60">Last checked</dt>
                    <dd className="text-white">{lastUpdated}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                  RAG env
                </h3>
                <StatusBadge
                  ok={
                    diagnostics.ragEnv.siteBaseUrlPresent &&
                    diagnostics.ragEnv.indexerSecretPresent &&
                    diagnostics.ragEnv.upstashUrlPresent &&
                    diagnostics.ragEnv.upstashTokenPresent &&
                    diagnostics.ragEnv.openaiKeyPresent
                  }
                  label={
                    diagnostics.ragEnv.siteBaseUrlPresent &&
                    diagnostics.ragEnv.indexerSecretPresent &&
                    diagnostics.ragEnv.upstashUrlPresent &&
                    diagnostics.ragEnv.upstashTokenPresent &&
                    diagnostics.ragEnv.openaiKeyPresent
                      ? "Ready"
                      : "Missing"
                  }
                />
              </div>
              <dl className="mt-4 space-y-2 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">SITE_BASE_URL</dt>
                  <dd>
                    {diagnostics.ragEnv.siteBaseUrlPresent
                      ? "Detected"
                      : "Missing"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">INDEXER_SECRET</dt>
                  <dd>
                    {diagnostics.ragEnv.indexerSecretPresent
                      ? "Detected"
                      : "Missing"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Upstash URL</dt>
                  <dd>
                    {diagnostics.ragEnv.upstashUrlPresent
                      ? "Detected"
                      : "Missing"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Upstash token</dt>
                  <dd>
                    {diagnostics.ragEnv.upstashTokenPresent
                      ? "Detected"
                      : "Missing"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">OpenAI key</dt>
                  <dd>
                    {diagnostics.ragEnv.openaiKeyPresent
                      ? "Detected"
                      : "Missing"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                  Supabase
                </h3>
                <StatusBadge
                  ok={!diagnostics.supabase.mismatch}
                  label={diagnostics.supabase.mismatch ? "Mismatch" : "OK"}
                />
              </div>
              <dl className="mt-4 space-y-2 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Server host</dt>
                  <dd className="text-white">
                    {diagnostics.supabase.serverHost ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Public host</dt>
                  <dd className="text-white">
                    {diagnostics.supabase.publicHost ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Source</dt>
                  <dd className="text-white">
                    {diagnostics.supabase.serverSource ?? "—"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                  Indexing
                </h3>
                <StatusBadge
                  ok={diagnostics.indexing.mode !== "disabled"}
                  label={diagnostics.indexing.mode}
                />
              </div>
              <dl className="mt-4 space-y-2 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Last reindex</dt>
                  <dd className="text-white">{lastReindex ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Last error</dt>
                  <dd className="text-white">
                    {diagnostics.indexing.lastError ?? "—"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                Local docs
              </h3>
              <dl className="mt-4 space-y-2 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Files loaded</dt>
                  <dd className="text-white">{diagnostics.localDocs.files}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/60">Chunks</dt>
                  <dd className="text-white">{diagnostics.localDocs.chunks}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {!diagnostics && !loading && !error && (
        <p className="mt-4 text-sm text-white/60">No diagnostics available.</p>
      )}
    </section>
  );
}
