-- Convênios aceitos pelo profissional e forma de pagamento dos agendamentos
alter table public.professional_profiles
  add column if not exists accepted_insurances text[] not null default '{}';

alter table public.appointments
  add column if not exists payment_type text not null default 'particular'
    check (payment_type in ('particular','convenio')),
  add column if not exists insurance_name text;

alter table public.appointments
  drop constraint if exists appointments_insurance_required;
alter table public.appointments
  add constraint appointments_insurance_required
  check (
    (payment_type = 'particular' and insurance_name is null)
    or
    (payment_type = 'convenio' and insurance_name is not null and length(trim(insurance_name)) > 0)
  );
