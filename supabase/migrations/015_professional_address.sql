-- Endereço do consultório usado pelo fluxo de localização do chatbot.
alter table public.professional_profiles
  add column if not exists address text;
