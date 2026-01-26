import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient;

let adminClient: Client | undefined;
let anonClient: Client | undefined;

type NextRequestInit = RequestInit & {
  next?: { revalidate?: number | false; tags?: string[] };
};

function noStoreFetch(input: RequestInfo | URL, init?: RequestInit) {
  const nextInit: NextRequestInit = {
    ...(init ?? {}),
    cache: "no-store",
  };
  return fetch(input, nextInit);
}

function resolveSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
}

function requireEnv(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function assertSupabaseUrl(value: string) {
  const candidate = value.trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(candidate);
  } catch {
    parsed = null;
  }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      "Invalid Supabase URL. Expected https://<project>.supabase.co (or http://localhost:54321). Check NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local");
  const isSupabaseHost =
    host.endsWith(".supabase.co") ||
    host.endsWith(".supabase.in") ||
    host.endsWith(".supabase.dev");

  if (!isLocal && !isSupabaseHost) {
    throw new Error(
      "Invalid Supabase URL. Expected https://<project>.supabase.co (or http://localhost:54321). Check NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.",
    );
  }
}

export function supabaseAdmin() {
  if (!adminClient) {
    const url = requireEnv(
      resolveSupabaseUrl(),
      "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL",
    ).trim();
    assertSupabaseUrl(url);
    const key = requireEnv(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    adminClient = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: noStoreFetch },
    });
  }
  return adminClient;
}

export function supabaseAnon() {
  if (!anonClient) {
    const url = requireEnv(
      resolveSupabaseUrl(),
      "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL",
    ).trim();
    assertSupabaseUrl(url);
    const key = requireEnv(
      process.env.SUPABASE_ANON_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      "SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    anonClient = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: noStoreFetch },
    });
  }
  return anonClient;
}
