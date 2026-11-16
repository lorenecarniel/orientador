-- Publicação controlada de perfis profissionais no diretório OrientaDor.
alter table public.professional_profiles
  add column if not exists is_public boolean not null default false;

-- A leitura pública ocorre por uma view com lista explícita de campos públicos.
-- O telefone privado e demais dados internos não são expostos pelo endpoint.
create or replace view public.professional_public_profiles
with (security_barrier = true) as
select
  id,
  full_name,
  professional_type,
  specialty,
  city,
  address,
  location_url,
  registration_number,
  public_bio,
  education,
  experience,
  public_email,
  website_url,
  instagram_url,
  linkedin_url,
  avatar_url,
  accepted_insurances
from public.professional_profiles
where is_public = true;

revoke all on public.professional_profiles from anon;
grant select on public.professional_public_profiles to anon, authenticated;
