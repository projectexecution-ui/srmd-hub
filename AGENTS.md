# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Key things that differ from older Next.js:
- `middleware.ts` is **deprecated**; use `proxy.ts` at the project root instead.
- See `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.

## This project's data contract

The Supabase project `srmd-projects-hub` (id `hjwtjrjkmuhhbsbjsqhx`) is **shared with an existing deployed app**. The schema and data are live. **Do NOT alter the schema** unless explicitly asked. Treat tables as read-mostly except for the writes specifically built into this UI (vendors, projects, indent notes, app_settings).

Tables you'll touch (all in `public`):
- `profiles` — `role` enum is `admin | uploader | viewer`
- `projects`, `vendors`
- `indents` + `indent_lines` (stage enum: `draft | submitted | verify | approved`)
- `purchase_orders` + `po_lines`
- `grns` + `grn_lines`
- `invoices` + `invoice_lines`
- `payments`
- `uploads`, `indent_status_snapshots`
- `app_settings` — holds `admin_email` etc.
- `zoho_tokens` — **DO NOT USE** in this UI (Zoho integration is intentionally excluded)

Helper SQL functions already exist: `current_user_role()`, `is_writer()`, `set_updated_at()`, `handle_new_user()`.

## Adding a new module (do it the SAME way every time)

There is ONE source of truth for modules: **`lib/modules.ts`** (the `MODULES`
array). Add one entry there and the module automatically appears, styled and
permission-gated, in ALL of these — do NOT hardcode the module anywhere else:

- Dashboard tiles (`visibleModules`)
- Sidebar nav (`components/NavBar.tsx`)
- Permissions matrix (`/admin/permissions`)
- Per-user role overrides + module blocks (the **Advanced** panel on `/admin/users`)
- My Approvals inbox styling (`/approvals` derives icon/label/colour from the registry)

### The checklist

1. **Registry** — add a `MODULES` entry in `lib/modules.ts`:
   `{ slug, label, description, href, icon, tone }`. The `slug` is the
   permanent key used by `role_permissions`, overrides, and blocks. Pick a
   `tone` from the `TILE_TONES` palette. Mark `comingSoon: true` to show the
   tile greyed before the pages exist; `external: true` for off-site links.
2. **Pages** — build the route under `app/(app)/<module>/`. Gate every page
   with `await requirePermission('<slug>', 'view' | 'edit' | 'admin')`.
3. **Permissions** — no migration needed: a missing `role_permissions` row
   reads as "off". The admin grants access per role from `/admin/permissions`.
   (Optionally seed defaults with an INSERT if the module should be on for
   some role out of the box.)
4. **Approvals (only if the module has an approve/reject flow)** — add its
   `approval_rules` rows via `/admin/approvals`. The generic
   `enforce_approval_via_matrix()` trigger + `can_approve()` already cover
   any module; you do NOT write per-module approval code. To show its items
   in `/approvals`, surface them through the `my_approval_inbox()` RPC, and
   (optional) add a nicer label in `MODULE_META_OVERRIDES` in
   `app/(app)/approvals/page.tsx`.
5. **Money / dates** — use `MoneyInput` (`components/ui/money-input.tsx`) for
   amounts and the `lib/utils` / `lib/jmr/format` helpers for display, so
   formatting stays uniform (Indian lakh/crore grouping everywhere).
6. **Errors** — destructure `error` from every Supabase call and show the
   `QueryError` banner (or a toast) instead of a blank/empty state. Use the
   app-styled `confirm()` from `components/ui/confirm-dialog.tsx`, never the
   native `window.confirm()`.

### The role model (keep it simple for laymen)

One role per person. A user's single `role` decides what they can do in
EVERY module via the `role_permissions` matrix. Per-module differences are
the rare exception, set under the **Advanced** button on `/admin/users`
(`user_module_roles` overrides + `user_module_blocks`). The allowlist's
"Starting role" is only the seed role on first sign-in. `effective_user_role(user_id, slug)`
resolves the override-or-default and is what `can_approve()` / `my_permissions()` use.
