-- OrientaDor | Impedir consultas em períodos bloqueados
-- Também impede criar um bloqueio sobre uma consulta já confirmada/pendente.
create or replace function public.prevent_appointment_block_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serializa alterações na agenda do mesmo profissional para evitar corrida.
  perform pg_advisory_xact_lock(hashtextextended(new.professional_id::text, 0));

  if tg_table_name = 'appointments' then
    if new.status in ('pending','confirmed') and exists (
      select 1
      from public.professional_calendar_blocks b
      where b.professional_id = new.professional_id
        and tstzrange(b.starts_at, b.ends_at, '[)') &&
            tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'Este horário está bloqueado na agenda. Escolha outro horário.';
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.professional_id = new.professional_id
      and a.status in ('pending','confirmed')
      and tstzrange(a.starts_at, a.ends_at, '[)') &&
          tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'Não é possível bloquear este período porque já existe uma consulta agendada.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_appointment_in_block on public.appointments;
create trigger trg_prevent_appointment_in_block
before insert or update of professional_id, starts_at, ends_at, status
on public.appointments
for each row execute function public.prevent_appointment_block_overlap();

drop trigger if exists trg_prevent_block_over_appointment on public.professional_calendar_blocks;
create trigger trg_prevent_block_over_appointment
before insert or update of professional_id, starts_at, ends_at
on public.professional_calendar_blocks
for each row execute function public.prevent_appointment_block_overlap();

