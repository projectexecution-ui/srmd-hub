# SRMD Hub

A single Next.js app that hosts every SRMD construction module behind one Odoo-style dashboard:

| Module           | Status      | What it does                                                    |
| ---------------- | ----------- | --------------------------------------------------------------- |
| Indents          | ✅ built     | List, view lines, view linked POs, edit internal notes          |
| Purchase Orders  | ✅ built     | List, view lines, **download PO as PDF**                        |
| GRN              | ✅ built     | List, view received lines (read-only)                           |
| Invoices         | ✅ built     | List, view lines (read-only)                                    |
| Vendors          | ✅ built     | List, create, edit                                              |
| Projects         | ✅ built     | List, create, edit (admin only)                                 |
| Uploads          | ✅ built     | Excel import history (read-only)                                |
| JMR              | placeholder | Coming soon — tile + page sketch                                |
| Budget vs Actual | placeholder | Coming soon                                                     |
| Payments         | placeholder | Coming soon                                                     |
| Attendance      | external    | Tile that opens the existing SiteAttend app in a new tab        |

## Stack

- **Next.js 16** + React 19 (App Router, `proxy.ts` not `middleware.ts`)
- **Supabase** for auth + Postgres (re-uses the existing `srmd-projects-hub` project — no schema changes)
- **Tailwind v4** + Radix UI primitives
- **jsPDF + jspdf-autotable** for PO PDF generation (no server-side dependency)
- **lucide-react** icons

## Roles

Existing roles in the database: `admin`, `uploader`, `viewer`.

- **admin** — everything, including user management, project master, settings
- **uploader** — can edit vendors, edit indent notes (but not user management or projects)
- **viewer** — read-only

Aksha's account (`construction@srmd.org`) is admin by virtue of the `app_settings.admin_email` row.

## What this app does NOT do

- **Excel upload parsing** — the existing pipeline at `srmd-hub.pages.dev` continues to handle this. This new UI just shows the result.
- **Zoho** — intentionally excluded. The `zoho_tokens` table is left untouched.
- **Schema changes** — the live data has 120 indents + 139 POs + GRNs + invoices, all read-mostly from this UI.

See **SETUP.md** for deploy steps.
