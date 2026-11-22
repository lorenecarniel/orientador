-- OrientaDor | Integração de pagamentos Mercado Pago
alter table public.professional_subscriptions
  add column if not exists payment_provider text,
  add column if not exists payment_status text not null default 'not_started'
    check (payment_status in ('not_started','pending','approved','rejected','cancelled','refunded','in_process')),
  add column if not exists payment_id text,
  add column if not exists payment_preference_id text,
  add column if not exists payment_external_reference text,
  add column if not exists payment_amount_cents integer,
  add column if not exists payment_currency text default 'BRL',
  add column if not exists paid_at timestamptz,
  add column if not exists payment_updated_at timestamptz;

create unique index if not exists professional_subscriptions_payment_id_uidx
  on public.professional_subscriptions(payment_id)
  where payment_id is not null;

create index if not exists professional_subscriptions_payment_reference_idx
  on public.professional_subscriptions(payment_external_reference)
  where payment_external_reference is not null;
