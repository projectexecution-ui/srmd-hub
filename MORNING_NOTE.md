# Good morning Aksha 🌅

While you were sleeping I built **`srmd-hub`** — a fresh Next.js app that wraps the existing Supabase data (project `srmd-projects-hub`) in a clean dashboard.

## What's done

- **Dashboard** with Odoo-style tile launcher — role-aware (tiles you can see depend on admin/uploader/viewer).
- **Indent → PO flow** fully wired:
  - Indents: list + filter by stage / project + detail page with all lines + linked POs + editable notes (admin/uploader).
  - POs: list + filter + detail page with line table + totals breakdown + **Download PDF** button.
  - GRN: list + detail.
  - Invoices: list + detail.
- **Vendor master** — list / create / edit (admin + uploader).
- **Project master** — list / create / edit (admin only).
- **Uploads** — read-only history of past Excel imports.
- **JMR** — placeholder tile + page (per your request: "I need to still work on that").
- **Attendance** — tile that opens your existing SiteAttend app in a new tab.
- **Admin → Users & Roles** — promote / demote users, deactivate accounts.
- **Admin → Settings** — edit `admin_email`.
- **Zoho** — fully excluded as requested. The `zoho_tokens` table is untouched.
- **No schema changes** — the live 120 indents / 139 POs / 121 GRNs / 118 invoices are all read straight from Supabase. Your existing app at `srmd-hub.pages.dev` keeps working.

## What I deliberately did NOT do (needs your call)

1. **`npm install`** — run it locally when you wake up. Some packages (like `jspdf-autotable@^5`) might need to resolve.
2. **Push to GitHub** — naming the repo is your call.
3. **Deploy to Vercel** — you'll want to pick the domain.
4. **Configure Google OAuth on Supabase `srmd-projects-hub`** — needs your Google Cloud project (5 min, instructions in `SETUP.md`).

All four steps are spelled out in `srmd-hub/SETUP.md`. Should take ~30 minutes end-to-end.

## Files to look at first

| File                                     | Why                                                        |
| ---------------------------------------- | ---------------------------------------------------------- |
| `srmd-hub/SETUP.md`                      | Step-by-step deploy guide                                  |
| `srmd-hub/README.md`                     | Module status table                                        |
| `srmd-hub/docs/INTEGRATIONS.md`          | How Gmail / Drive / PDF / Scheduled Tasks plug in next     |
| `srmd-hub/app/(app)/dashboard/page.tsx`  | Dashboard — the Odoo-style entry point                     |
| `srmd-hub/lib/modules.ts`                | Edit this to add / remove tiles or change tone colours     |
| `srmd-hub/lib/po-pdf.ts`                 | PO PDF template — tweak letterhead text here               |

## Quick start (when you're at the desk)

```bash
cd srmd-hub
cp .env.local.example .env.local
npm install
npm run dev
```

Open <http://localhost:3000>, sign in with `construction@srmd.org`, and you should see all your real data in the new UI.

If anything compiles or renders weird, ping me with the exact error and I'll patch it.

— Claude
