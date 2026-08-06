-- ============================================================
-- role_permissions: audit who changes a permission cell
-- ============================================================
-- Symptom: permissions "got revoked after some time" with no way to see who /
-- what did it. Root cause was two-fold — some seeds used `on conflict DO UPDATE`
-- (now converted to DO NOTHING), and the matrix's write never recorded an author
-- (updated_by was null on every row), so a human toggle and a system re-seed were
-- indistinguishable.
--
-- This trigger stamps updated_by on EVERY write: a human toggle in
-- /admin/permissions runs under that admin's JWT (auth.uid() = them); a
-- service-role seed/migration has auth.uid() = null. So going forward, a null
-- updated_by = system re-seed, a non-null = a specific person — the exact signal
-- that was missing. Additive + non-breaking (only fills previously-null columns).
create or replace function public.set_role_permissions_audit()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_role_permissions_audit on public.role_permissions;
create trigger trg_role_permissions_audit
  before insert or update on public.role_permissions
  for each row execute function public.set_role_permissions_audit();

-- Re-grant what a re-seed wiped: management (Trustee/founder) needs inventory
-- VIEW to open the module and reach the Reports.
update public.role_permissions
  set can_view = true
  where role = 'founder' and module_slug = 'inventory';
