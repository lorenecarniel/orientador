-- OrientaDor | Localização/criação segura de paciente por telefone
-- Usado pelo agendamento e pelo backend do chatbot para evitar cadastros duplicados.

create or replace function public.find_or_create_patient_by_phone(
  p_professional_id uuid,
  p_full_name text,
  p_phone text,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_phone_digits text;
begin
  if p_professional_id is null then
    raise exception 'Profissional não informado';
  end if;

  if auth.uid() is not null and auth.uid() <> p_professional_id then
    raise exception 'Acesso não autorizado';
  end if;

  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Nome do paciente é obrigatório';
  end if;

  v_phone_digits := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');

  if v_phone_digits is not null then
    select p.id
      into v_patient_id
      from public.patients p
     where p.professional_id = p_professional_id
       and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = v_phone_digits
     order by p.created_at asc
     limit 1;
  end if;

  if v_patient_id is not null then
    update public.patients
       set email = coalesce(nullif(trim(email), ''), nullif(trim(p_email), '')),
           updated_at = now()
     where id = v_patient_id;
    return v_patient_id;
  end if;

  insert into public.patients (professional_id, full_name, phone, email)
  values (
    p_professional_id,
    trim(p_full_name),
    nullif(trim(p_phone), ''),
    nullif(trim(p_email), '')
  )
  returning id into v_patient_id;

  return v_patient_id;
end;
$$;

revoke all on function public.find_or_create_patient_by_phone(uuid, text, text, text) from public;
grant execute on function public.find_or_create_patient_by_phone(uuid, text, text, text) to authenticated, service_role;
