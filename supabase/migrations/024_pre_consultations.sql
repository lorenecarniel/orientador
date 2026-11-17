-- Pré-consultas enviadas pelo site público do OrientaDor.
create table if not exists public.pre_consultations (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  patient_name text not null check (char_length(patient_name) between 2 and 140),
  patient_phone text not null check (char_length(patient_phone) between 8 and 30),
  patient_email text,
  region text,
  side text,
  assessment_answers jsonb not null default '{}'::jsonb,
  assessment_summary jsonb not null default '{}'::jsonb,
  triage_risk text,
  status text not null default 'new' check (status in ('new','contacted','converted','closed')),
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pre_consultations_professional_created_idx
  on public.pre_consultations (professional_id, created_at desc);
alter table public.pre_consultations enable row level security;
revoke all on public.pre_consultations from anon, authenticated;
grant select, update on public.pre_consultations to authenticated;
drop policy if exists "Professionals read own pre-consultations" on public.pre_consultations;
create policy "Professionals read own pre-consultations"
  on public.pre_consultations for select to authenticated
  using (professional_id = (select auth.uid()));
drop policy if exists "Professionals update own pre-consultations" on public.pre_consultations;
create policy "Professionals update own pre-consultations"
  on public.pre_consultations for update to authenticated
  using (professional_id = (select auth.uid()))
  with check (professional_id = (select auth.uid()));
