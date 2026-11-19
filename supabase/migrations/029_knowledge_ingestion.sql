-- OrientaDor | Ingestão e recuperação semântica da biblioteca
create extension if not exists vector with schema extensions;

alter table public.knowledge_sources
  add column if not exists processing_status text not null default 'pending'
    check (processing_status in ('pending','processing','processed','failed')),
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz;

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  token_estimate integer not null default 0,
  embedding extensions.vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(source_id, chunk_index)
);

create index if not exists knowledge_chunks_source_idx on public.knowledge_chunks(source_id);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;
drop policy if exists "knowledge_chunks_admin_select" on public.knowledge_chunks;
create policy "knowledge_chunks_admin_select" on public.knowledge_chunks
for select to authenticated using (public.has_platform_role('admin'));

revoke all on public.knowledge_chunks from anon, public;
grant select on public.knowledge_chunks to authenticated;

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 6,
  filter_category text default null
)
returns table (
  chunk_id uuid,
  source_id uuid,
  title text,
  category text,
  source_type text,
  author text,
  institution text,
  publication_year integer,
  source_url text,
  chunk_content text,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    kc.id,
    ks.id,
    ks.title,
    ks.category,
    ks.source_type,
    ks.author,
    ks.institution,
    ks.publication_year,
    ks.source_url,
    kc.content,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  join public.knowledge_sources ks on ks.id = kc.source_id
  where ks.status = 'approved'
    and ks.processing_status = 'processed'
    and (filter_category is null or ks.category = filter_category)
  order by kc.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 6), 20));
$$;

revoke all on function public.match_knowledge_chunks(extensions.vector, integer, text) from public, anon, authenticated;
grant execute on function public.match_knowledge_chunks(extensions.vector, integer, text) to service_role;
