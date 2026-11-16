-- OrientaDor | Agenda profissional e agendamentos
-- Execute no SQL Editor do Supabase.
create extension if not exists btree_gist;

create table if not exists public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  price numeric(10,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.professional_availability (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_interval_minutes integer not null default 60 check (slot_interval_minutes between 5 and 480),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create table if not exists public.professional_calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  appointment_type_id uuid references public.appointment_types(id) on delete set null,
  conversation_id uuid references public.chatbot_conversations(id) on delete set null,
  patient_name text not null,
  patient_phone text,
  patient_email text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('pending','confirmed','cancelled','completed','no_show')),
  source text not null default 'professional' check (source in ('professional','chatbot','whatsapp')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_appointment_types_professional on public.appointment_types(professional_id,is_active);
create index if not exists idx_availability_professional_weekday on public.professional_availability(professional_id,weekday,is_active);
create index if not exists idx_calendar_blocks_professional_time on public.professional_calendar_blocks(professional_id,starts_at,ends_at);
create index if not exists idx_appointments_professional_time on public.appointments(professional_id,starts_at);
create index if not exists idx_appointments_conversation on public.appointments(conversation_id);

alter table public.appointment_types enable row level security;
alter table public.professional_availability enable row level security;
alter table public.professional_calendar_blocks enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "professionals manage own appointment types" on public.appointment_types;
create policy "professionals manage own appointment types" on public.appointment_types for all to authenticated using (professional_id=auth.uid()) with check (professional_id=auth.uid());
drop policy if exists "professionals manage own availability" on public.professional_availability;
create policy "professionals manage own availability" on public.professional_availability for all to authenticated using (professional_id=auth.uid()) with check (professional_id=auth.uid());
drop policy if exists "professionals manage own calendar blocks" on public.professional_calendar_blocks;
create policy "professionals manage own calendar blocks" on public.professional_calendar_blocks for all to authenticated using (professional_id=auth.uid()) with check (professional_id=auth.uid());
drop policy if exists "professionals manage own appointments" on public.appointments;
create policy "professionals manage own appointments" on public.appointments for all to authenticated using (professional_id=auth.uid()) with check (professional_id=auth.uid());

-- Evita sobreposição de consultas confirmadas ou pendentes do mesmo profissional.
do $$ begin
  alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending','confirmed'));
exception when duplicate_object then null;
end $$;

-- Reserva atômica: duas solicitações simultâneas não conseguem ocupar o mesmo horário.
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

revoke all on function public.book_appointment(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.book_appointment(uuid,text,text,text,timestamptz,timestamptz,uuid,uuid,text,text) to service_role;
