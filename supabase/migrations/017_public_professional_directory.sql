-- Publicação controlada de perfis profissionais no diretório OrientaDor.
alter table public.professional_profiles
  add column if not exists is_public boolean not null default false;

drop policy if exists "public can read published professional profiles" on public.professional_profiles;
create policy "public can read published professional profiles"
  on public.professional_profiles
  for select
  to anon, authenticated
  using (is_public = true);

grant select on public.professional_profiles to anon, authenticated;
