-- Corrige a permissão da reserva manual pelo painel profissional.
-- Usuários autenticados só podem reservar na própria agenda.
-- A Edge Function com service_role poderá reservar em nome do profissional após validar o fluxo.
create or replace function public.book_appointment(
  p_professional_id uuid,
  p_patient_name text,
  p_patient_phone text,
  p_patient_email text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_appointment_type_id uuid default null,
  p_conversation_id uuid default null,
  p_source text default 'chatbot',
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not (
    (auth.uid() is not null and auth.uid() = p_professional_id)
    or auth.role() = 'service_role'
  ) then
    raise exception 'Você não tem permissão para agendar nesta agenda.';
  end if;

  if p_patient_name is null or length(trim(p_patient_name))=0 then raise exception 'Informe o nome do paciente.'; end if;
  if p_ends_at <= p_starts_at then raise exception 'Intervalo de horário inválido.'; end if;
  if p_starts_at <= now() then raise exception 'Escolha um horário futuro.'; end if;
  if p_source not in ('professional','chatbot','whatsapp') then raise exception 'Origem inválida.'; end if;

  insert into public.appointments(professional_id,appointment_type_id,conversation_id,patient_name,patient_phone,patient_email,starts_at,ends_at,status,source,notes)
  values(p_professional_id,p_appointment_type_id,p_conversation_id,trim(p_patient_name),nullif(trim(p_patient_phone),''),nullif(trim(p_patient_email),''),p_starts_at,p_ends_at,'confirmed',p_source,p_notes)
  returning id into v_id;
  return v_id;
exception when exclusion_violation then
  raise exception 'Este horário acabou de ser reservado. Escolha outro horário.';
end;
$$;

revoke all on function public.book_appointment(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,text) from public, anon;
grant execute on function public.book_appointment(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,text) to authenticated, service_role;
