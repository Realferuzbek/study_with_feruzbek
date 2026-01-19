do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'email_verified_at'
  ) then
    alter table public.users
      add column email_verified_at timestamptz;
  end if;
end
$$;

create table if not exists public.email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now()
);

create index if not exists idx_email_verification_codes_user_id
  on public.email_verification_codes(user_id);
