-- OrientaDor | Preços oficiais dos planos
-- Valores em centavos para evitar arredondamentos monetários.

alter table public.plan_catalog
  add column if not exists monthly_price_cents integer not null default 4990
    check (monthly_price_cents >= 0),
  add column if not exists annual_price_cents integer not null default 54990
    check (annual_price_cents >= 0);

update public.plan_catalog
set monthly_price_cents = case plan_key
      when 'basic' then 4990
      when 'complete' then 9990
      else monthly_price_cents
    end,
    annual_price_cents = case plan_key
      when 'basic' then 54990
      when 'complete' then 114990
      else annual_price_cents
    end;
