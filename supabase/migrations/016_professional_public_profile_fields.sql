-- Campos complementares para a página pública do profissional.
alter table public.professional_profiles
  add column if not exists location_url text,
  add column if not exists registration_number text,
  add column if not exists education text,
  add column if not exists experience text,
  add column if not exists public_email text,
  add column if not exists website_url text,
  add column if not exists instagram_url text,
  add column if not exists linkedin_url text;
