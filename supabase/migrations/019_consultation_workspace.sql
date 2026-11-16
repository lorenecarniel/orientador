-- OrientaDor | Campos clínicos do paciente e armazenamento de anexos
alter table public.patients
  add column if not exists sex text,
  add column if not exists occupation text,
  add column if not exists family_history text,
  add column if not exists medical_history text,
  add column if not exists allergies text,
  add column if not exists medications text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('consultation-attachments', 'consultation-attachments', false, 15728640,
  array['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = 15728640;

drop policy if exists "professionals upload own consultation attachments" on storage.objects;
create policy "professionals upload own consultation attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'consultation-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "professionals read own consultation attachments" on storage.objects;
create policy "professionals read own consultation attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'consultation-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "professionals delete own consultation attachments" on storage.objects;
create policy "professionals delete own consultation attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'consultation-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
