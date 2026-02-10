# AGENTS.md — Repository instructions for coding agents (Codex)

These rules exist to keep changes safe, reviewable, and aligned with the project’s security posture.

## Project snapshot
- **Framework:** Next.js (App Router) + TypeScript
- **Realtime:** 100ms (`@100mslive/react-sdk`)
- **Backend:** Supabase (`@supabase/supabase-js`, SQL migrations in `supabase/migrations`)
- **Auth:** NextAuth (`next-auth`)
- **Security:** strict CSP + other security headers (validated by tests)

## Prime directive
**Do not change business logic.** Only fix bugs, reliability issues, and UX polish.
Business logic includes (non-exhaustive):
- token issuance / role selection for 100ms
- session visibility rules (public/private), join permissions
- Supabase schema, RLS policies, billing/usage accounting
- authentication flows and session cookies

If a change touches any of the above, stop and explain what needs to be decided by a human.

## Where things live (important files)
### Live / Focus sessions (100ms)
- UI + join flow: `components/live/FocusmateSessionRoom.tsx`
- Studio/lobby UI: `components/live/*`
- 100ms helpers (server-only): `lib/voice/hms.ts`
- Token endpoints:
  - `app/api/100ms/token/route.ts`
  - `app/api/focus-sessions/[sessionId]/token/route.ts`
  - `app/api/voice/token/route.ts`

### Security headers / CSP
- Header definitions: `lib/security-headers.js`
- Edge middleware applying headers: `middleware.ts`
- Security header tests: `scripts/security-headers.test.js`
- Semgrep rules: `.semgrep-rules/*`

### Database
- Migrations: `supabase/migrations/*.sql`
- Do not modify old migrations; add new migrations only.

## Hard security rules
1. **Never log secrets** (HMS keys, Supabase keys, JWTs, tokens). If you must log, redact.
2. **CSP is allowlist-only.** If you add a domain or directive, it must be justified and tested.
3. Do not weaken protections like `frame-ancestors`, `object-src`, `base-uri`, etc.
4. `middleware.ts` runs on the Edge — do not introduce Node-only APIs there.

## Realtime / WebRTC reliability rules
- Assume some users are on slow networks or restricted firewalls.
- Avoid short hard timeouts that create false negatives (users can still be connecting).
- Provide recovery UX:
  - “Still connecting…” state (non-blocking)
  - Retry / rejoin button
  - Clear message when `navigator.onLine` is false
- Always clean up on unmount: leave rooms, stop tracks when appropriate, clear timers.
- Keep UI resilient to missing tracks (camera-only, screen-only, muted, etc.).

## Editing guidelines
- Keep diffs small and localized.
- Prefer refactors only when strictly needed to fix a bug.
- No new dependencies unless absolutely necessary.
- Maintain TypeScript strictness and existing patterns.

## Required checks before you say “done”
Run these from the repo root:
- `npm run lint`
- `npm run test:security`
- `npm run build`

If your change impacts other areas, also run the closest relevant tests:
- `npm run test:csrf`
- `npm run test:session`
- `npm run test:blocked`
- `npm run test:highlight`

If you cannot run commands in your environment, state exactly what should be run and why.

## CSP / headers change protocol
When modifying `lib/security-headers.js`:
- Update `scripts/security-headers.test.js` expectations if needed.
- Validate that `connect-src` still allows required services:
  - Supabase endpoints used by the app
  - 100ms endpoints (`https://*.100ms.live` and `wss://*.100ms.live`)
- Prefer the most restrictive directive that works:
  - if adding workers, use `worker-src` (and add `blob:` only if required)
  - avoid `*` wildcards

## PR-quality output format
When delivering a fix, include:
1. **Root cause** (what broke and for whom)
2. **Change list** (files touched + why)
3. **How to verify** (manual steps + commands)
4. **Risk assessment** (what could regress)

## When you must stop and ask for human action
- DNS / deployment config changes (Vercel, reverse proxy, custom headers outside app)
- Network allowlisting / firewall policies for WebSocket/WebRTC
- Secrets/keys setup in hosting environment
- Supabase RLS or production data migrations that need review
