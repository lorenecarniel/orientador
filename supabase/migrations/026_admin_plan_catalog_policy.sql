-- OrientaDor | Permissões de administração do catálogo de planos
-- Somente administradores podem alterar planos e recursos. A leitura pública de planos ativos permanece.
drop policy if exists "Admins manage plan catalog" on public.plan_catalog;
grant insert, update, delete on public.plan_catalog to authenticated;

create policy "Admins manage plan catalog"
  on public.plan_catalog for all to authenticated
  using (public.has_platform_role('admin'))
  with check (public.has_platform_role('admin'));
