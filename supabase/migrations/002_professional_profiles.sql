-- OrientaDor | Perfis profissionais
-- Execute depois da migration 001 no SQL Editor do Supabase.

create table if not exists public.professional_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  professional_type text,
  specialty text,
  phone text,
  city text,
  public_bio text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_professional_profiles_specialty
  on public.professional_profiles(specialty);

alter table public.professional_profiles enable row level security;

drop policy if exists "professionals read own profile" on public.professional_profiles;
create policy "professionals read own profile"
  on public.professional_profiles for select
  to authenticated using (id = (select auth.uid()));

drop policy if exists "professionals create own profile" on public.professional_profiles;
create policy "professionals create own profile"
  on public.professional_profiles for insert
  to authenticated with check (id = (select auth.uid()));

drop policy if exists "professionals update own profile" on public.professional_profiles;
create policy "professionals update own profile"
  on public.professional_profiles for update
  to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.set_professional_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists professional_profiles_updated_at on public.professional_profiles;
create trigger professional_profiles_updated_at
before update on public.professional_profiles
for each row execute function public.set_professional_profile_updated_at();

-- Cria automaticamente um perfil quando uma conta é cadastrada no Supabase Auth.
create or replace function public.handle_new_professional_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.professional_profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_professional on auth.users;
create trigger on_auth_user_created_professional
after insert on auth.users
for each row execute procedure public.handle_new_professional_user();

-- Recupera perfis para contas criadas antes da instalação desta migration.
insert into public.professional_profiles (id, full_name)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do nothing;

grant select, insert, update on public.professional_profiles to authenticated;
