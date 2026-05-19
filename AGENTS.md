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
