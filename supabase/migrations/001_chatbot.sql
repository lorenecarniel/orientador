-- OrientaDor | Chatbot de atendimento em saúde
-- Migration inicial: execute no SQL Editor do projeto Supabase.
create extension if not exists pgcrypto;

create table if not exists public.chatbots (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  channel_mode text not null default 'web' check (channel_mode in ('web','whatsapp_individual','whatsapp_central','multi')),
  status text not null default 'draft' check (status in ('draft','published','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chatbot_templates (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  definition jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.chatbot_flows (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  name text not null,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  definition jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique(chatbot_id, version)
);

create table if not exists public.chatbot_channels (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  chatbot_id uuid references public.chatbots(id) on delete set null,
  provider text not null check (provider in ('meta_cloud_api','web_widget')),
  connection_mode text not null check (connection_mode in ('professional_number','platform_number','web')),
  display_phone text,
  provider_phone_number_id text,
  provider_business_account_id text,
  webhook_verified_at timestamptz,
  status text not null default 'pending' check (status in ('pending','connected','disconnected','error')),
  created_at timestamptz not null default now()
);

create table if not exists public.chatbot_conversations (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  chatbot_id uuid references public.chatbots(id) on delete set null,
  channel_id uuid references public.chatbot_channels(id) on delete set null,
  channel text not null check (channel in ('web','whatsapp')),
  external_contact_id text,
  patient_name text,
  status text not null default 'open' check (status in ('open','waiting_human','in_progress','closed')),
  current_node_id text,
  variables jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.chatbot_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chatbot_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text',
  content text not null,
  provider_message_id text,
  delivery_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chatbots_professional on public.chatbots(professional_id);
create index if not exists idx_flows_chatbot on public.chatbot_flows(chatbot_id, version desc);
create index if not exists idx_channels_professional on public.chatbot_channels(professional_id);
create index if not exists idx_conversations_professional_last on public.chatbot_conversations(professional_id, last_message_at desc);
create index if not exists idx_messages_conversation_created on public.chatbot_messages(conversation_id, created_at);

alter table public.chatbots enable row level security;
alter table public.chatbot_flows enable row level security;
alter table public.chatbot_channels enable row level security;
alter table public.chatbot_conversations enable row level security;
alter table public.chatbot_messages enable row level security;
alter table public.chatbot_templates enable row level security;

create policy "professionals manage own chatbots" on public.chatbots
for all using (professional_id = auth.uid()) with check (professional_id = auth.uid());

create policy "professionals manage flows of own chatbots" on public.chatbot_flows
for all using (exists (select 1 from public.chatbots c where c.id = chatbot_id and c.professional_id = auth.uid()))
with check (exists (select 1 from public.chatbots c where c.id = chatbot_id and c.professional_id = auth.uid()));

create policy "professionals manage own channels" on public.chatbot_channels
for all using (professional_id = auth.uid()) with check (professional_id = auth.uid());

create policy "professionals manage own conversations" on public.chatbot_conversations
for all using (professional_id = auth.uid()) with check (professional_id = auth.uid());

create policy "professionals manage messages in own conversations" on public.chatbot_messages
for all using (exists (select 1 from public.chatbot_conversations c where c.id = conversation_id and c.professional_id = auth.uid()))
with check (exists (select 1 from public.chatbot_conversations c where c.id = conversation_id and c.professional_id = auth.uid()));

create policy "authenticated users read active templates" on public.chatbot_templates
for select to authenticated using (is_active = true);

-- IMPORTANTE:
-- Tokens da Meta, segredos de webhook e service_role nunca devem ser armazenados
-- no frontend. Use Supabase Edge Functions e Secrets para operações privilegiadas.
-- Antes de produção, associe professional_id ao cadastro real de profissionais
-- do OrientaDor (não assuma que auth.users.id é o ID definitivo do profissional).
