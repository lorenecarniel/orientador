-- Adiciona modalidade presencial/online ao agendamento e persiste a escolha.
alter table public.appointments
  add column if not exists modality text not null default 'presencial'
  check (modality in ('presencial','online'));

drop function if exists public.book_appointment(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,text,text,text);

create function public.book_appointment(
  p_professional_id uuid,
  p_patient_name text,
  p_patient_phone text,
  p_patient_email text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_appointment_type_id uuid default null,
  p_conversation_id uuid default null,
  p_source text default 'chatbot',
  p_notes text default null,
  p_payment_type text default 'particular',
  p_insurance_name text default null,
  p_modality text default 'presencial'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not ((auth.uid() is not null and auth.uid() = p_professional_id) or auth.role() = 'service_role') then
    raise exception 'Você não tem permissão para agendar nesta agenda.';
  end if;
  if p_patient_name is null or length(trim(p_patient_name))=0 then raise exception 'Informe o nome do paciente.'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Intervalo de horário inválido.'; end if;
  if p_starts_at <= now() then raise exception 'Escolha um horário futuro.'; end if;
  if p_source not in ('professional','chatbot','whatsapp') then raise exception 'Origem inválida.'; end if;
  if p_payment_type not in ('particular','convenio') then raise exception 'Forma de pagamento inválida.'; end if;
  if p_modality not in ('presencial','online') then raise exception 'Modalidade inválida.'; end if;
  if p_payment_type='convenio' and nullif(trim(p_insurance_name),'') is null then raise exception 'Selecione o convênio.'; end if;
  if p_payment_type='particular' then p_insurance_name := null; end if;

  if p_payment_type='convenio' and not exists (
    select 1 from public.professional_profiles pp
    where pp.id=p_professional_id and trim(p_insurance_name)=any(pp.accepted_insurances)
  ) then raise exception 'Este profissional não aceita o convênio selecionado.'; end if;

  insert into public.appointments(professional_id,appointment_type_id,conversation_id,patient_name,patient_phone,patient_email,starts_at,ends_at,status,source,notes,payment_type,insurance_name,modality)
  values(p_professional_id,p_appointment_type_id,p_conversation_id,trim(p_patient_name),nullif(trim(p_patient_phone),''),nullif(trim(p_patient_email),''),p_starts_at,p_ends_at,'confirmed',p_source,p_notes,p_payment_type,nullif(trim(p_insurance_name),''),p_modality)
  returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'Este horário acabou de ser reservado. Escolha outro horário.';
end;
$$;

revoke all on function public.book_appointment(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,text,text,text,text) from public, anon;
grant execute on function public.book_appointment(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,text,text,text,text) to authenticated, service_role;
