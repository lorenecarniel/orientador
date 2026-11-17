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
