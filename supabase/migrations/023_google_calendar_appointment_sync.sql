-- Google Calendar sync metadata for professional appointments.
alter table public.appointments
  add column if not exists google_calendar_event_id text,
  add column if not exists google_calendar_event_url text,
  add column if not exists google_meet_url text,
  add column if not exists google_calendar_sync_status text not null default 'not_synced'
    check (google_calendar_sync_status in ('not_synced','synced','error','cancelled')),
  add column if not exists google_calendar_sync_error text;

create index if not exists idx_appointments_google_calendar_event
  on public.appointments(professional_id, google_calendar_event_id)
  where google_calendar_event_id is not null;

-- The synchronization metadata is written only by the trusted Edge Function.
create or replace function public.protect_google_calendar_sync_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and (
    new.google_calendar_event_id is distinct from old.google_calendar_event_id
    or new.google_calendar_event_url is distinct from old.google_calendar_event_url
    or new.google_meet_url is distinct from old.google_meet_url
    or new.google_calendar_sync_status is distinct from old.google_calendar_sync_status
    or new.google_calendar_sync_error is distinct from old.google_calendar_sync_error
  ) then
    raise exception 'Os dados de sincronização do Google Agenda são gerenciados pelo sistema.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_google_calendar_sync_metadata on public.appointments;
create trigger protect_google_calendar_sync_metadata
before update on public.appointments
for each row execute function public.protect_google_calendar_sync_metadata();
