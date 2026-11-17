create table if not exists public.google_calendar_connections (
  professional_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  encrypted_tokens text not null,
  encryption_iv text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from anon, authenticated;
grant select on public.google_calendar_connections to authenticated;
drop policy if exists "Professionals can view own Google connection" on public.google_calendar_connections;
create policy "Professionals can view own Google connection"
  on public.google_calendar_connections for select to authenticated
  using (auth.uid() = professional_id);

create table if not exists public.google_calendar_oauth_states (
  state text primary key,
  professional_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.google_calendar_oauth_states enable row level security;
revoke all on public.google_calendar_oauth_states from anon, authenticated;
