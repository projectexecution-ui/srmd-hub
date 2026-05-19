# Integration Plan

How the connectors we already have wire into SRMD Hub. Each section is short, has a concrete trigger, and points at the exact files to touch when you're ready.

---

## 1. Gmail — approval / notification emails

**What we want**: when an indent is raised or moves to `verify` / `approved`, email the PM + Purchase Head a one-click summary.

**How**:

- Add a Next.js Route Handler at `app/api/notify/route.ts`.
- It receives `{ kind: 'indent.submitted' | 'indent.approved' | 'po.issued', id }`.
- Server-side, it loads the entity from Supabase and calls Gmail via the connected MCP.
- Trigger the route from:
  - the Indent detail page when notes are added (already a write surface), or
  - a Supabase **Database Webhook** on `indents` (recommended once we want real-time).

**Wiring**:

- Store recipient emails in `app_settings` (keys: `pm_email`, `purchase_head_email`).
- For approval requests, include a magic link to `/indents/[id]`.

**No new DB table required.**

---

## 2. Google Drive — signed PO / quotation storage

**What we want**: keep a folder per project with the scanned signed POs and vendor quotations.

**How**:

- On the PO detail page, add an `Upload signed PDF` button → posts the file to `app/api/po/[id]/attach/route.ts`.
- The route uploads to a project-named folder in Drive via the MCP and stores the Drive file ID in a new column `purchase_orders.signed_pdf_drive_id`.

**Migration needed** (additive, safe):

```sql
alter table public.purchase_orders
  add column if not exists signed_pdf_drive_id text,
  add column if not exists signed_pdf_url text;
```

Run via the Supabase MCP `apply_migration` when ready.

---

## 3. PDF Tools — vendor PO PDFs

**Status**: already done client-side. `lib/po-pdf.ts` builds the PO PDF with jsPDF + autoTable. The `Download PDF` button on a PO detail uses it.

**Possible upgrade** (only if needed): server-side generation with the PDF Tools MCP for letterhead / signature watermarks. Not required for v1.

---

## 4. Scheduled Tasks — daily digest

**What**: a 6 AM digest to admins listing yesterday's new indents / POs.

**How**:

- Create a scheduled task that hits `/api/digest/daily` once a day.
- The route queries `created_at > now() - interval '24 hours'` across the indent/PO tables and emails via Gmail.

---

## 5. Supabase — schema changes log

If you ever need a new column / table, do it via the **Supabase MCP** `apply_migration` with a snake_case name like `add_po_signed_pdf`. **Never** edit existing tables in the dashboard SQL editor without a migration record, because the existing app at `srmd-hub.pages.dev` is running against the same DB.

---

## 6. Excluded — Zoho

The `zoho_tokens` table is intentionally not surfaced anywhere in this UI. Aksha asked for the new app to have no Zoho integration. Leave the table alone (the existing app may still use it).

---

## 7. Where the existing live data lives

If you ever wonder "where did indent IND/SRASSK/NGH/2026-27/12 come from?":

- Open `/uploads` — every row links back to the Excel file that created/updated it via `indents.upload_id → uploads.id`.
- The `indent_status_snapshots` table captures the *before* state of each upload, so the existing pipeline can render an audit "what changed" diff.
- The new UI doesn't write these tables; it only reads them.
