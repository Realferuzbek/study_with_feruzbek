create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  creator_user_id text not null,
  starts_at timestamptz not null,
  duration_minutes int not null check (duration_minutes > 0),
  hms_room_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.focus_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.focus_sessions(id) on delete cascade,
  user_id text not null,
  joined_at timestamptz not null default now()
);

create index if not exists idx_focus_sessions_creator
  on public.focus_sessions (creator_user_id, starts_at desc);

create index if not exists idx_focus_session_participants_session
  on public.focus_session_participants (session_id, joined_at);

create unique index if not exists idx_focus_session_participants_unique
  on public.focus_session_participants (session_id, user_id);
