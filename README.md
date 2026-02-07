# TheStudyMate

A **Next.js 14** study accountability platform with:
- **Leaderboards** (ingested via a protected API)
- **Live voice rooms** (100ms)
- **Community live chat** + **Web Push notifications**
- **Planner / task scheduler + notes** (Supabase + migrations)
- A **site-grounded AI assistant** (crawler + embeddings + Upstash Vector + OpenAI)

> The default public site URL referenced by configuration is `https://thestudymate.vercel.app`.  
> You can override this via `NEXT_PUBLIC_SITE_URL`.

---

## What problem this solves

Studying alone often fails due to weak accountability and inconsistent structure.  
This project combines:
- visible progress (**leaderboards**),
- real-time community momentum (**live voice + chat**),
- daily planning tools (**scheduler/notes**),
- and a grounded assistant for fast answers inside the product (**RAG**).

---

## Main features (implemented in this repo)

### Leaderboards
- Protected ingest endpoint: `POST /api/leaderboard/ingest` (requires secret header)
- Read endpoints: `GET /api/leaderboard/latest`, `GET /api/leaderboard`
- Health endpoint: `GET /api/leaderboard/health`
- Cron route present: `GET /api/cron/leaderboard`

### Live voice rooms (100ms)
- Uses `@100mslive/react-sdk`
- Server-side token flow + room configuration driven by env variables

### Community live chat + Web Push
- Live/community chat routes under `/api/community/...`
- Web push subscribe/unsubscribe + public key endpoints:
  - `/api/community/push/public-key`
  - `/api/community/push/subscribe`
  - `/api/community/push/unsubscribe`
  - plus live-room equivalents under `/api/community/live/push/...`

### Planner / scheduler + notes (Supabase migrations included)
- Task scheduler + recurrence + notes/habits are represented in Supabase migrations under:
  - `supabase/migrations/*task_scheduler*`
  - `supabase/migrations/*notes*`
  - `supabase/migrations/*recurrence*`

### Site-grounded AI assistant (RAG)
- Uses OpenAI for moderation + embeddings + generation
- Uses Upstash Vector for retrieval
- Uses a crawler/indexer flow controlled by `SITE_BASE_URL`, allow/block path lists, and secrets
- AI chat storage includes redaction + DB retention (90-day cleanup trigger is present in migrations)

Relevant endpoints:
- `POST /api/chat`
- `POST /api/reindex`
- `GET/POST /api/cron/nightly-reindex`

Vercel cron is configured (see `vercel.json`) to hit:
- `/api/cron/nightly-reindex`

---

## Tech stack

- Next.js 14 (App Router), React 18, TypeScript
- TailwindCSS
- NextAuth (`/api/auth/[...nextauth]`)
- Supabase (Postgres + migrations)
- OpenAI (moderation/embeddings/generation)
- Upstash Vector (retrieval)
- 100ms (live voice)
- Web Push (`web-push`)

---

## Run locally

### 1) Install
```bash
npm ci
```

### 2) Configure environment
```bash
cp .env.example .env.local
```

### 3) Start dev server
```bash
npm run dev
```

The dev server runs on:
- `http://localhost:3000`

---

## Environment variables

These are **names only** (never commit values).  
The required variables are listed in `.env.example`.

### Supabase
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### NextAuth + OAuth
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GITHUB_ID`
- `GITHUB_SECRET`

### Telegram integration
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_GROUP_ID`
- `TELEGRAM_BOT_USERNAME`
- `PUBLIC_TG_GROUP_LINK`

### Cron/Webhook secret
- `CRON_SECRET`

### Web push
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_SUBJECT`

### Leaderboard ingest
- `LEADERBOARD_INGEST_SECRET`
- `LEADERBOARD_TIMEZONE` (defaults to `Asia/Tashkent`)

### OpenAI
- `OPENAI_API_KEY`
- `OPENAI_GEN_MODEL` (default in `.env.example`: `gpt-5-mini`)
- `OPENAI_EMBED_MODEL` (default in `.env.example`: `text-embedding-3-small`)

### Upstash Vector
- `UPSTASH_VECTOR_REST_URL`
- `UPSTASH_VECTOR_REST_TOKEN`
- `UPSTASH_INDEX_NAME` (default: `focus-squad-site`)
- `UPSTASH_VECTOR_DIM` (default: `1536`)

### Crawler / indexing
- `SITE_BASE_URL`
- `INDEXER_SECRET`
- `CRAWL_MAX_PAGES`
- `CRAWL_MAX_DEPTH`
- `CRAWL_ALLOWED_PATHS`
- `CRAWL_BLOCKED_PATHS`
- `POST_DEPLOY_REINDEX_URL` (optional)

### 100ms Live Voice Rooms
- `HMS_APP_ACCESS_KEY`
- `HMS_APP_SECRET`
- `HMS_TEMPLATE_ID`
- `NEXT_PUBLIC_SITE_URL`
- `LIVE_ROOMS_DEFAULT_MAX_SIZE` (default: `30`)
- `LIVE_ROOMS_DEFAULT_VISIBILITY` (default: `public`)

### Optional telemetry (default: off)
- `ENABLE_TELEMETRY` (`1` enables Vercel Web Analytics + Speed Insights; unset/`0` keeps them disabled)

---

## Optional dev/testing flags (used in code, not listed in `.env.example`)

These are read directly from `process.env` by the AI/RAG modules:
- `USE_MOCK_AI`
- `USE_MOCK_VECTOR`
- `MOCK_EMBED_DIM`

---

## Database (Supabase)

SQL migrations are under:
- `supabase/migrations/`

Apply them to your Supabase project (chronological order).  
They include schemas for:
- leaderboards + ingest logs/metadata
- AI chat logs/memory/preferences + retention cleanup trigger (90 days)
- scheduler / recurrence / notes-related tables

---

## AI assistant: indexing & reindexing

### Manual reindex
`POST /api/reindex`

Auth (one of):
- `Authorization: Bearer <INDEXER_SECRET>`
- `x-indexer-secret: <INDEXER_SECRET>`

What it does:
- crawls site pages from `SITE_BASE_URL`
- chunks + embeds content
- upserts vectors to Upstash Vector
- stores reindex state in Supabase (`rag_reindex_state`)

### Nightly reindex (cron)
- `/api/cron/nightly-reindex` (scheduled via `vercel.json`)

---

## Security posture (implemented in code)

- `middleware.ts` applies security headers and CSRF protections (via `lib/security-headers` and `lib/csrf*`)
- AI chat logging applies redaction before storage (see `lib/ai-chat/redaction.ts`)
- AI chat retention cleanup trigger exists in Supabase migrations (90 days)

---

## My role & contributions

I led the project as product owner + context/architecture engineer:
- defined product flows and integration design
- handled configuration, deployment, and system-level debugging
- used AI-assisted coding tools for implementation acceleration while owning final decisions and shipping

---

## License

Add a license file if/when you decide the intended openness level.
