-- OrientaDor | Histórico de simulações
-- Execute no SQL Editor do Supabase antes de usar o histórico.
alter table public.chatbot_conversations
  add column if not exists is_test boolean not null default false,
  add column if not exists flow_id uuid references public.chatbot_flows(id) on delete set null;

create index if not exists idx_conversations_professional_test_last
  on public.chatbot_conversations(professional_id, is_test, last_message_at desc);

create index if not exists idx_conversations_flow
  on public.chatbot_conversations(flow_id);

-- As políticas RLS existentes de chatbot_conversations e chatbot_messages
-- continuam protegendo os registros pelo professional_id do usuário autenticado.
