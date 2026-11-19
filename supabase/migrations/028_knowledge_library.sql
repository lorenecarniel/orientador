-- OrientaDor | Biblioteca de conhecimento revisada para a orientação educativa
-- Conteúdos ficam privados e só administradores podem gerenciar/revisar.

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  parent_source_id uuid references public.knowledge_sources(id) on delete set null,
  version integer not null default 1 check (version > 0),
  title text not null check (char_length(trim(title)) between 3 and 240),
  summary text,
  category text not null default 'musculoskeletal',
  body_region text,
  source_type text not null default 'guideline',
  author text,
  institution text,
  publication_year integer check (publication_year is null or publication_year between 1900 and 2100),
  source_url text,
  content_text text,
  storage_path text,
  status text not null default 'draft' check (status in ('draft','in_review','approved','archived')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_sources_parent_version_unique unique(parent_source_id, version)
);

create index if not exists knowledge_sources_status_idx on public.knowledge_sources(status);
create index if not exists knowledge_sources_category_idx on public.knowledge_sources(category);
create index if not exists knowledge_sources_parent_idx on public.knowledge_sources(parent_source_id);

alter table public.knowledge_sources enable row level security;

drop policy if exists "knowledge_sources_admin_select" on public.knowledge_sources;
create policy "knowledge_sources_admin_select" on public.knowledge_sources
for select to authenticated using (public.has_platform_role('admin'));

drop policy if exists "knowledge_sources_admin_insert" on public.knowledge_sources;
create policy "knowledge_sources_admin_insert" on public.knowledge_sources
for insert to authenticated with check (public.has_platform_role('admin'));

drop policy if exists "knowledge_sources_admin_update" on public.knowledge_sources;
create policy "knowledge_sources_admin_update" on public.knowledge_sources
for update to authenticated using (public.has_platform_role('admin')) with check (public.has_platform_role('admin'));

drop policy if exists "knowledge_sources_admin_delete" on public.knowledge_sources;
create policy "knowledge_sources_admin_delete" on public.knowledge_sources
for delete to authenticated using (public.has_platform_role('admin'));

revoke all on public.knowledge_sources from anon, public;
grant select, insert, update, delete on public.knowledge_sources to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-library', 'knowledge-library', false, 20971520, array['application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "knowledge_library_admin_read" on storage.objects;
create policy "knowledge_library_admin_read" on storage.objects
for select to authenticated using (bucket_id = 'knowledge-library' and public.has_platform_role('admin'));

drop policy if exists "knowledge_library_admin_insert" on storage.objects;
create policy "knowledge_library_admin_insert" on storage.objects
for insert to authenticated with check (bucket_id = 'knowledge-library' and public.has_platform_role('admin'));

drop policy if exists "knowledge_library_admin_update" on storage.objects;
create policy "knowledge_library_admin_update" on storage.objects
for update to authenticated using (bucket_id = 'knowledge-library' and public.has_platform_role('admin'))
with check (bucket_id = 'knowledge-library' and public.has_platform_role('admin'));

drop policy if exists "knowledge_library_admin_delete" on storage.objects;
create policy "knowledge_library_admin_delete" on storage.objects
for delete to authenticated using (bucket_id = 'knowledge-library' and public.has_platform_role('admin'));
