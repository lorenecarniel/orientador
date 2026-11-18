-- OrientaDor | Planos, onboarding profissional e permissões administrativas
-- Pagamentos ficam desativados nesta etapa. A seleção registra apenas a intenção de contratação.

alter table public.professional_profiles
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending','approved','rejected','suspended')),
  add column if not exists onboarding_step text not null default 'profile'
    check (onboarding_step in ('profile','review','completed')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists admin_notes text;

-- Perfis já publicados permanecem aprovados; novos cadastros exigem revisão.
update public.professional_profiles
set approval_status = 'approved',
    onboarding_step = 'completed'
where is_public = true and approval_status = 'pending';

create table if not exists public.platform_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','support')),
  created_at timestamptz not null default now()
);

alter table public.platform_roles enable row level security;
revoke all on public.platform_roles from anon, authenticated;

create or replace function public.has_platform_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_roles
    where user_id = (select auth.uid()) and role = required_role
  );
$$;
revoke all on function public.has_platform_role(text) from public, anon;
grant execute on function public.has_platform_role(text) to authenticated;

create table if not exists public.plan_catalog (
  plan_key text primary key check (plan_key in ('basic','complete')),
  name text not null,
  description text not null default '',
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.plan_catalog enable row level security;
revoke all on public.plan_catalog from anon, authenticated;
grant select on public.plan_catalog to anon, authenticated;
drop policy if exists "Anyone can read active plans" on public.plan_catalog;
create policy "Anyone can read active plans"
  on public.plan_catalog for select to anon, authenticated
  using (is_active = true);

insert into public.plan_catalog (plan_key,name,description,features)
values
 ('basic','Básico','Gestão essencial da rotina de atendimento.',
  '["Agenda de consultas","Cadastro de pacientes","Prontuário e histórico","Gestão de horários","Perfil profissional público"]'::jsonb),
 ('complete','Completo','Gestão, inteligência artificial e automações.',
  '["Tudo do Básico","Chatbot inteligente","Triagem automatizada","Pré-consulta inteligente","Assistente de IA","Automações avançadas"]'::jsonb)
on conflict (plan_key) do update set
 name = excluded.name,
 description = excluded.description,
 features = excluded.features;

create table if not exists public.professional_subscriptions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  plan_key text not null references public.plan_catalog(plan_key),
  billing_period text not null check (billing_period in ('monthly','annual')),
  status text not null default 'pending_activation'
    check (status in ('pending_activation','active','cancelled','expired','suspended')),
  payment_enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists professional_subscriptions_owner_idx
  on public.professional_subscriptions (professional_id, created_at desc);
alter table public.professional_subscriptions enable row level security;
revoke all on public.professional_subscriptions from anon, authenticated;
grant select on public.professional_subscriptions to authenticated;

drop policy if exists "Professionals read own subscription" on public.professional_subscriptions;
create policy "Professionals read own subscription"
  on public.professional_subscriptions for select to authenticated
  using (professional_id = (select auth.uid()) or public.has_platform_role('admin'));

drop policy if exists "Admins manage subscriptions" on public.professional_subscriptions;
create policy "Admins manage subscriptions"
  on public.professional_subscriptions for all to authenticated
  using (public.has_platform_role('admin'))
  with check (public.has_platform_role('admin'));

drop policy if exists "Admins manage professional profiles" on public.professional_profiles;
create policy "Admins manage professional profiles"
  on public.professional_profiles for all to authenticated
  using (public.has_platform_role('admin'))
  with check (public.has_platform_role('admin'));

-- Seleção de plano feita pelo próprio profissional. Não ativa cobrança nem assinatura.
create or replace function public.request_professional_plan(
  requested_plan text,
  requested_period text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_subscription_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'É necessário entrar na conta.';
  end if;
  if requested_plan not in ('basic','complete') then
    raise exception 'Plano inválido.';
  end if;
  if requested_period not in ('monthly','annual') then
    raise exception 'Periodicidade inválida.';
  end if;
  if not exists (select 1 from public.plan_catalog where plan_key = requested_plan and is_active) then
    raise exception 'Plano indisponível.';
  end if;

  insert into public.professional_subscriptions
    (professional_id, plan_key, billing_period, status, payment_enabled)
  values
    (current_user_id, requested_plan, requested_period, 'pending_activation', false)
  returning id into new_subscription_id;

  return new_subscription_id;
end;
$$;
revoke all on function public.request_professional_plan(text,text) from public, anon;
grant execute on function public.request_professional_plan(text,text) to authenticated;
