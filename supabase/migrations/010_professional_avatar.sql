-- Foto de perfil do profissional exibida no painel e no chat público
alter table public.professional_profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('professional-avatars','professional-avatars',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "Professional avatars are publicly readable" on storage.objects;
create policy "Professional avatars are publicly readable"
on storage.objects for select
to public
using (bucket_id='professional-avatars');

drop policy if exists "Professionals upload own avatar" on storage.objects;
create policy "Professionals upload own avatar"
on storage.objects for insert
to authenticated
with check (bucket_id='professional-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "Professionals update own avatar" on storage.objects;
create policy "Professionals update own avatar"
on storage.objects for update
to authenticated
using (bucket_id='professional-avatars' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='professional-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "Professionals delete own avatar" on storage.objects;
create policy "Professionals delete own avatar"
on storage.objects for delete
to authenticated
using (bucket_id='professional-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
