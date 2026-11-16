-- OrientaDor | Disponibilidade inteligente e validação de horários
-- Execute no SQL Editor do Supabase após as migrations 006, 007 e 008.

-- Fuso horário usado para interpretar os dias e horários semanais do profissional.
alter table public.professional_availability
  add column if not exists timezone text not null default 'America/Sao_Paulo';

-- Lista horários livres para uma data e duração específicas.
create or replace function public.get_available_slots(
  p_professional_id uuid,
  p_date date,
  p_duration_minutes integer default 60
) returns table(starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    (auth.uid() is not null and auth.uid() = p_professional_id)
    or auth.role() = 'service_role'
  ) then
    raise exception 'Você não tem permissão para consultar esta agenda.';
  end if;

  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'Duração de consulta inválida.';
  end if;

  return query
  select candidate.slot_start at time zone av.timezone,
         (candidate.slot_start + make_interval(mins => p_duration_minutes)) at time zone av.timezone
  from public.professional_availability av
  cross join lateral generate_series(
    (p_date + av.start_time),
    (p_date + av.end_time - make_interval(mins => p_duration_minutes)),
    make_interval(mins => av.slot_interval_minutes)
  ) as candidate(slot_start)
  where av.professional_id = p_professional_id
    and av.is_active = true
    and av.weekday = extract(dow from p_date)::integer
    and av.end_time - av.start_time >= make_interval(mins => p_duration_minutes)
    and candidate.slot_start at time zone av.timezone > now()
    and not exists (
      select 1 from public.appointments ap
      where ap.professional_id = av.professional_id
        and ap.status in ('pending','confirmed')
        and tstzrange(ap.starts_at,ap.ends_at,'[)') &&
            tstzrange(candidate.slot_start at time zone av.timezone,
                      (candidate.slot_start + make_interval(mins => p_duration_minutes)) at time zone av.timezone,'[)')
    )
    and not exists (
      select 1 from public.professional_calendar_blocks bl
      where bl.professional_id = av.professional_id
        and tstzrange(bl.starts_at,bl.ends_at,'[)') &&
            tstzrange(candidate.slot_start at time zone av.timezone,
                      (candidate.slot_start + make_interval(mins => p_duration_minutes)) at time zone av.timezone,'[)')
    )
  order by 1;
end;
$$;

revoke all on function public.get_available_slots(uuid,date,integer) from public, anon;
grant execute on function public.get_available_slots(uuid,date,integer) to authenticated, service_role;

-- Valida também reservas diretas/RPC: a consulta deve caber em um período de atendimento.
-- Se o profissional ainda não cadastrou disponibilidade, mantém o agendamento manual atual.
create or replace function public.validate_appointment_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type_duration integer;
  v_has_availability boolean;
  v_fits_availability boolean;
begin
  if new.status not in ('pending','confirmed') then
    return new;
  end if;

  if new.appointment_type_id is not null then
    select duration_minutes into v_type_duration
    from public.appointment_types
    where id = new.appointment_type_id
      and professional_id = new.professional_id
      and is_active = true;

    if v_type_duration is null then
      raise exception 'Tipo de consulta inválido ou inativo.';
    end if;

    if extract(epoch from (new.ends_at-new.starts_at))/60 <> v_type_duration then
      raise exception 'A duração não corresponde ao tipo de consulta selecionado.';
    end if;
  end if;

  select exists(
    select 1 from public.professional_availability
    where professional_id = new.professional_id and is_active = true
  ) into v_has_availability;

  if not v_has_availability then
    return new;
  end if;

  select exists(
    select 1
    from public.professional_availability av
    where av.professional_id = new.professional_id
      and av.is_active = true
      and av.weekday = extract(dow from (new.starts_at at time zone av.timezone))::integer
      and (new.starts_at at time zone av.timezone)::time >= av.start_time
      and (new.ends_at at time zone av.timezone)::time <= av.end_time
      and (new.ends_at at time zone av.timezone)::date = (new.starts_at at time zone av.timezone)::date
  ) into v_fits_availability;

  if not v_fits_availability then
    raise exception 'Este horário está fora dos seus períodos de atendimento.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_appointment_availability on public.appointments;
create trigger trg_validate_appointment_availability
before insert or update of professional_id, appointment_type_id, starts_at, ends_at, status
on public.appointments
for each row execute function public.validate_appointment_availability();
