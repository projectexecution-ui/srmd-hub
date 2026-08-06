-- ============================================================
-- Blueprint Demo: default permissions
-- ============================================================
-- Per AGENTS.md, a missing role_permissions row reads as "off" —
-- which is why the demo tile wasn't appearing on the dashboard
-- after we shipped the slug + pages. This seeds sensible defaults
-- so the demo is reachable out of the box for the roles that
-- actually drive its state machine:
--   admin     — full (view/edit/admin) — uses the smart admin matrix
--   head      — view + edit (intake reviewer in the demo flow)
--   founder   — view + edit (approver in the demo flow)
--   engineer  — view + edit (raiser in the demo flow)
-- Other roles get nothing — they won't see the tile.
-- Safe to re-run; seeds a default ONLY when the row is absent — it must never
-- override a manual grant an admin set in /admin/permissions (do nothing, not
-- do update), otherwise re-applying this migration silently reverts the matrix.

insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin)
values
  ('admin',    'blueprint-demo', true, true, true),
  ('head',     'blueprint-demo', true, true, false),
  ('founder',  'blueprint-demo', true, true, false),
  ('engineer', 'blueprint-demo', true, true, false)
on conflict (role, module_slug) do nothing;
