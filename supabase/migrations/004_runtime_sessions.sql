-- OrientaDor | Base segura para execução pública de fluxos
-- Execute depois das migrations 001, 002 e 003.

alter table public.chatbot_conversations
  add column if not exists flow_version integer,
  add column if not exists runtime_token_hash text;

create unique index if not exists idx_chatbot_conversations_runtime_token
  on public.chatbot_conversations(runtime_token_hash)
  where runtime_token_hash is not null;

create index if not exists idx_chatbot_flows_published
  on public.chatbot_flows(chatbot_id, version desc)
  where status = 'published';

comment on column public.chatbot_conversations.runtime_token_hash is
  'Hash SHA-256 do token de sessão público; o token original nunca é armazenado.';
comment on column public.chatbot_conversations.flow_version is
  'Versão imutável do fluxo que iniciou esta conversa.';
