-- OrientaDor | Atendimento humano
-- Execute depois das migrations 001 a 004 no SQL Editor do Supabase.

alter table public.chatbot_conversations
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists human_requested_at timestamptz,
  add column if not exists human_started_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists handoff_channel text;

alter table public.chatbot_messages
  add column if not exists sender_type text not null default 'chatbot',
  add column if not exists sender_id uuid references auth.users(id) on delete set null;

alter table public.chatbot_messages
  drop constraint if exists chatbot_messages_sender_type_check;

alter table public.chatbot_messages
  add constraint chatbot_messages_sender_type_check
  check (sender_type in ('chatbot','patient','professional','system'));

alter table public.chatbot_conversations
  drop constraint if exists chatbot_conversations_handoff_channel_check;

alter table public.chatbot_conversations
  add constraint chatbot_conversations_handoff_channel_check
  check (handoff_channel is null or handoff_channel in ('panel','whatsapp'));

create index if not exists idx_conversations_human_queue
  on public.chatbot_conversations(professional_id, status, last_message_at desc)
  where is_test = false;

create index if not exists idx_conversations_assigned
  on public.chatbot_conversations(assigned_to, status, last_message_at desc)
  where assigned_to is not null;

create index if not exists idx_messages_sender
  on public.chatbot_messages(conversation_id, sender_type, created_at);

comment on column public.chatbot_conversations.assigned_to is
  'Profissional responsável pelo atendimento humano.';
comment on column public.chatbot_conversations.handoff_channel is
  'Canal escolhido para continuidade humana: painel ou WhatsApp.';
comment on column public.chatbot_messages.sender_type is
  'Origem da mensagem: chatbot, paciente, profissional ou sistema.';
