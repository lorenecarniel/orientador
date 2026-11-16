-- Modalidade do atendimento: presencial ou online
alter table public.appointment_types
  add column if not exists modality text not null default 'presencial'
  check (modality in ('presencial','online'));
