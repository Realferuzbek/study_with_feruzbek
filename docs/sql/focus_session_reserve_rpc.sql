-- Apply this in Supabase SQL editor before deploying the reserve/token API changes.
-- It adds participant roles and an atomic seat-claim RPC used by:
--   POST /api/focus-sessions/[sessionId]/reserve
--   POST /api/focus-sessions/[sessionId]/token

alter table public.focus_session_participants
  add column if not exists role text;

update public.focus_session_participants
set role = 'participant'
where role is null;

alter table public.focus_session_participants
  alter column role set default 'participant',
  alter column role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'focus_session_participants_role_check'
      and conrelid = 'public.focus_session_participants'::regclass
  ) then
    alter table public.focus_session_participants
      add constraint focus_session_participants_role_check
      check (role in ('host', 'participant'));
  end if;
end
$$;

update public.focus_session_participants p
set role = 'host'
from public.focus_sessions s
where p.session_id = s.id
  and p.user_id = s.host_id;

create index if not exists idx_focus_session_participants_user_session
  on public.focus_session_participants (user_id, session_id);

create index if not exists idx_focus_sessions_status_window
  on public.focus_sessions (status, start_at, end_at);

create or replace function public.focus_session_claim_seat(
  p_session_id uuid,
  p_user_id text,
  p_role text default 'participant'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_user_id text := btrim(coalesce(p_user_id, ''));
  v_requested_role text := lower(btrim(coalesce(p_role, 'participant')));
  v_session_host_id text;
  v_session_start timestamptz;
  v_session_end timestamptz;
  v_session_status text;
  v_session_max int;
  v_existing_role text;
  v_participant_count int;
  v_conflict boolean;
begin
  if p_session_id is null or v_user_id = '' then
    return jsonb_build_object('code', 'error');
  end if;

  if v_requested_role not in ('host', 'participant') then
    return jsonb_build_object('code', 'invalid_role');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id));

  select
    s.host_id,
    s.start_at,
    coalesce(
      s.end_at,
      s.start_at + make_interval(mins => greatest(coalesce(s.duration_minutes, 0), 0))
    ),
    coalesce(s.status, 'scheduled'),
    coalesce(s.max_participants, 3)
  into
    v_session_host_id,
    v_session_start,
    v_session_end,
    v_session_status,
    v_session_max
  from public.focus_sessions s
  where s.id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  if v_session_status not in ('scheduled', 'active') then
    return jsonb_build_object(
      'code', 'session_unavailable',
      'session_status', v_session_status,
      'max_participants', v_session_max
    );
  end if;

  if v_requested_role = 'host' and v_session_host_id is distinct from v_user_id then
    return jsonb_build_object('code', 'host_conflict');
  end if;

  if v_requested_role = 'participant' and v_session_host_id = v_user_id then
    return jsonb_build_object('code', 'host_conflict');
  end if;

  select p.role
  into v_existing_role
  from public.focus_session_participants p
  where p.session_id = p_session_id
    and p.user_id = v_user_id
  limit 1;

  if found then
    if v_session_host_id = v_user_id and coalesce(v_existing_role, '') <> 'host' then
      update public.focus_session_participants
      set role = 'host'
      where session_id = p_session_id
        and user_id = v_user_id;
      v_existing_role := 'host';
    elsif coalesce(v_existing_role, '') not in ('host', 'participant') then
      update public.focus_session_participants
      set role = 'participant'
      where session_id = p_session_id
        and user_id = v_user_id;
      v_existing_role := 'participant';
    end if;

    select count(*)::int
    into v_participant_count
    from public.focus_session_participants p
    where p.session_id = p_session_id;

    return jsonb_build_object(
      'code', 'already_participant',
      'participant_count', v_participant_count,
      'max_participants', v_session_max,
      'my_role', coalesce(v_existing_role, case when v_session_host_id = v_user_id then 'host' else 'participant' end),
      'session_status', v_session_status
    );
  end if;

  select exists (
    select 1
    from public.focus_sessions s
    where s.host_id = v_user_id
      and s.id <> p_session_id
      and coalesce(s.status, 'scheduled') in ('scheduled', 'active')
      and s.start_at <= v_now
      and coalesce(
        s.end_at,
        s.start_at + make_interval(mins => greatest(coalesce(s.duration_minutes, 0), 0))
      ) > v_now
  )
  into v_conflict;

  if v_conflict then
    return jsonb_build_object('code', 'active_conflict');
  end if;

  select exists (
    select 1
    from public.focus_session_participants p
    join public.focus_sessions s on s.id = p.session_id
    where p.user_id = v_user_id
      and p.session_id <> p_session_id
      and coalesce(s.status, 'scheduled') in ('scheduled', 'active')
      and s.start_at <= v_now
      and coalesce(
        s.end_at,
        s.start_at + make_interval(mins => greatest(coalesce(s.duration_minutes, 0), 0))
      ) > v_now
  )
  into v_conflict;

  if v_conflict then
    return jsonb_build_object('code', 'active_conflict');
  end if;

  select exists (
    select 1
    from public.focus_sessions s
    where s.host_id = v_user_id
      and s.id <> p_session_id
      and coalesce(s.status, 'scheduled') in ('scheduled', 'active')
      and s.start_at < v_session_end
      and coalesce(
        s.end_at,
        s.start_at + make_interval(mins => greatest(coalesce(s.duration_minutes, 0), 0))
      ) > v_session_start
  )
  into v_conflict;

  if v_conflict then
    return jsonb_build_object('code', 'overlap_conflict');
  end if;

  select exists (
    select 1
    from public.focus_session_participants p
    join public.focus_sessions s on s.id = p.session_id
    where p.user_id = v_user_id
      and p.session_id <> p_session_id
      and coalesce(s.status, 'scheduled') in ('scheduled', 'active')
      and s.start_at < v_session_end
      and coalesce(
        s.end_at,
        s.start_at + make_interval(mins => greatest(coalesce(s.duration_minutes, 0), 0))
      ) > v_session_start
  )
  into v_conflict;

  if v_conflict then
    return jsonb_build_object('code', 'overlap_conflict');
  end if;

  select count(*)::int
  into v_participant_count
  from public.focus_session_participants p
  where p.session_id = p_session_id;

  if v_participant_count >= v_session_max then
    return jsonb_build_object(
      'code', 'session_full',
      'participant_count', v_participant_count,
      'max_participants', v_session_max,
      'session_status', v_session_status
    );
  end if;

  insert into public.focus_session_participants (session_id, user_id, role)
  values (p_session_id, v_user_id, v_requested_role)
  on conflict (session_id, user_id)
  do update set role = excluded.role;

  select count(*)::int
  into v_participant_count
  from public.focus_session_participants p
  where p.session_id = p_session_id;

  return jsonb_build_object(
    'code', 'reserved',
    'participant_count', v_participant_count,
    'max_participants', v_session_max,
    'my_role', v_requested_role,
    'session_status', v_session_status
  );
exception
  when others then
    return jsonb_build_object('code', 'error');
end;
$$;

revoke all on function public.focus_session_claim_seat(uuid, text, text) from public;
revoke all on function public.focus_session_claim_seat(uuid, text, text) from anon;
revoke all on function public.focus_session_claim_seat(uuid, text, text) from authenticated;
grant execute on function public.focus_session_claim_seat(uuid, text, text) to service_role;
