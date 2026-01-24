alter table public.focus_sessions
  add column if not exists ends_at timestamptz,
  add column if not exists status text not null default 'scheduled',
  add column if not exists task text,
  add column if not exists title text,
  add column if not exists max_participants int not null default 3;

update public.focus_sessions
set ends_at = starts_at + (duration_minutes || ' minutes')::interval
where ends_at is null;

update public.focus_sessions
set status = 'scheduled'
where status is null;

update public.focus_sessions
set max_participants = 3
where max_participants is null;
