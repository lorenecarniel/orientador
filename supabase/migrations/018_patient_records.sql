-- OrientaDor | Cadastro central de pacientes e prontuário
-- Cada profissional acessa apenas seus pacientes, consultas e anexos.

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  birth_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(full_name)) > 0)
);

create index if not exists idx_patients_professional_name
  on public.patients(professional_id, full_name);

create index if not exists idx_patients_professional_phone
  on public.patients(professional_id, phone);

alter table public.appointments
  add column if not exists patient_id uuid references public.patients(id) on delete set null;

create index if not exists idx_appointments_patient
  on public.appointments(patient_id, starts_at desc);

create table if not exists public.consultation_records (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  consultation_date timestamptz not null default now(),
  consultation_type text,
  chief_complaint text,
  clinical_history text,
  evolution text,
  assessment text,
  plan text,
  general_notes text,
  status text not null default 'in_progress'
    check (status in ('in_progress','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_consultation_records_patient_date
  on public.consultation_records(professional_id, patient_id, consultation_date desc);

create index if not exists idx_consultation_records_appointment
  on public.consultation_records(appointment_id);

create table if not exists public.consultation_attachments (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  consultation_record_id uuid references public.consultation_records(id) on delete set null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists idx_consultation_attachments_patient
  on public.consultation_attachments(professional_id, patient_id, created_at desc);

alter table public.patients enable row level security;
alter table public.consultation_records enable row level security;
alter table public.consultation_attachments enable row level security;

drop policy if exists "professionals manage own patients" on public.patients;
create policy "professionals manage own patients"
  on public.patients for all to authenticated
  using (professional_id = auth.uid())
  with check (professional_id = auth.uid());

drop policy if exists "professionals manage own consultation records" on public.consultation_records;
create policy "professionals manage own consultation records"
  on public.consultation_records for all to authenticated
  using (
    professional_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_id and p.professional_id = auth.uid()
    )
  )
  with check (
    professional_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_id and p.professional_id = auth.uid()
    )
  );

drop policy if exists "professionals manage own consultation attachments" on public.consultation_attachments;
create policy "professionals manage own consultation attachments"
  on public.consultation_attachments for all to authenticated
  using (
    professional_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_id and p.professional_id = auth.uid()
    )
  )
  with check (
    professional_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_id and p.professional_id = auth.uid()
    )
  );

-- Mantém o vínculo do agendamento limitado ao paciente do mesmo profissional.
drop policy if exists "professionals manage own appointments" on public.appointments;
create policy "professionals manage own appointments"
  on public.appointments for all to authenticated
  using (professional_id = auth.uid())
  with check (
    professional_id = auth.uid()
    and (
      patient_id is null
      or exists (
        select 1 from public.patients p
        where p.id = patient_id and p.professional_id = auth.uid()
      )
    )
  );
