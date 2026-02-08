create index if not exists live_stream_members_active_user_id_idx
  on public.live_stream_members (user_id)
  where left_at is null;

create index if not exists live_stream_members_active_joined_at_idx
  on public.live_stream_members (joined_at desc)
  where left_at is null;
