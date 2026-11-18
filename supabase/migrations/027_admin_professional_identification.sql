-- OrientaDor | Identificação segura de profissionais na administração
-- Corrige nomes ausentes a partir dos metadados já fornecidos no cadastro
-- e disponibiliza e-mail/data de criação somente por RPC restrita a administradores.

update public.professional_profiles p
set full_name = trim(u.raw_user_meta_data ->> 'full_name')
from auth.users u
where u.id = p.id
  and coalesce(trim(p.full_name), '') = ''
  and coalesce(trim(u.raw_user_meta_data ->> 'full_name'), '') <> '';

create or replace function public.admin_list_professionals()
returns table (
  id uuid,
  full_name text,
  email text,
  professional_type text,
  specialty text,
  phone text,
  city text,
  is_public boolean,
  approval_status text,
  onboarding_step text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_platform_role('admin') then
    raise exception 'Acesso restrito a administradores.';
  end if;

  return query
  select
    p.id,
    coalesce(nullif(trim(p.full_name), ''), nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), 'Cadastro sem nome') as full_name,
    u.email::text as email,
    p.professional_type,
    p.specialty,
    p.phone,
    p.city,
    p.is_public,
    p.approval_status,
    p.onboarding_step,
    coalesce(p.created_at, u.created_at) as created_at
  from public.professional_profiles p
  join auth.users u on u.id = p.id
  order by coalesce(p.created_at, u.created_at) desc;
end;
$$;

revoke all on function public.admin_list_professionals() from public, anon;
grant execute on function public.admin_list_professionals() to authenticated;
