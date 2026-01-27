-- Align focus sessions schema with Live Stream Studio requirements and add RLS policies.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'creator_user_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'host_id'
  ) then
    alter table public.focus_sessions
      rename column creator_user_id to host_id;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'host_id'
  ) then
    alter table public.focus_sessions
      add column host_id text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'starts_at'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'start_at'
  ) then
    alter table public.focus_sessions
      rename column starts_at to start_at;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'start_at'
  ) then
    alter table public.focus_sessions
      add column start_at timestamptz;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'ends_at'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'end_at'
  ) then
    alter table public.focus_sessions
      rename column ends_at to end_at;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'end_at'
  ) then
    alter table public.focus_sessions
      add column end_at timestamptz;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'hms_room_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'room_id'
  ) then
    alter table public.focus_sessions
      rename column hms_room_id to room_id;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'room_id'
  ) then
    alter table public.focus_sessions
      add column room_id text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'status'
  ) then
    alter table public.focus_sessions
      add column status text not null default 'scheduled';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'task'
  ) then
    alter table public.focus_sessions
      add column task text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'max_participants'
  ) then
    alter table public.focus_sessions
      add column max_participants int not null default 3;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'creator_user_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'host_id'
  ) then
    execute 'update public.focus_sessions set host_id = creator_user_id where host_id is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'starts_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'start_at'
  ) then
    execute 'update public.focus_sessions set start_at = starts_at where start_at is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'ends_at'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'end_at'
  ) then
    execute 'update public.focus_sessions set end_at = ends_at where end_at is null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'hms_room_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'focus_sessions'
      and column_name = 'room_id'
  ) then
    execute 'update public.focus_sessions set room_id = hms_room_id where room_id is null';
  end if;
end
$$;

update public.focus_sessions
set end_at = start_at + (duration_minutes || ' minutes')::interval
where end_at is null
  and start_at is not null
  and duration_minutes is not null;

update public.focus_sessions
set status = 'scheduled'
where status is null;

update public.focus_sessions
set max_participants = 3
where max_participants is null;

alter table public.focus_sessions enable row level security;
alter table public.focus_session_participants enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'focus_sessions'
      and policyname = 'focus_sessions_select_public'
  ) then
    create policy focus_sessions_select_public
      on public.focus_sessions
      for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'focus_sessions'
      and policyname = 'focus_sessions_insert_authenticated'
  ) then
    create policy focus_sessions_insert_authenticated
      on public.focus_sessions
      for insert
      with check (auth.uid() is not null and auth.uid()::text = host_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'focus_sessions'
      and policyname = 'focus_sessions_update_host_cancel'
  ) then
    create policy focus_sessions_update_host_cancel
      on public.focus_sessions
      for update
      using (auth.uid() is not null and auth.uid()::text = host_id)
      with check (
        auth.uid() is not null
        and auth.uid()::text = host_id
        and status = 'cancelled'
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'focus_session_participants'
      and policyname = 'focus_session_participants_select_public'
  ) then
    create policy focus_session_participants_select_public
      on public.focus_session_participants
      for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'focus_session_participants'
      and policyname = 'focus_session_participants_insert_authenticated'
  ) then
    create policy focus_session_participants_insert_authenticated
      on public.focus_session_participants
      for insert
      with check (auth.uid() is not null and auth.uid()::text = user_id);
  end if;
end
$$;
