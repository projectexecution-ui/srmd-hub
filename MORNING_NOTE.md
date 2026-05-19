# Good morning Aksha 🌅

**Your new app is LIVE at <https://srmd-hub.vercel.app>** ✅

Everything I could do on your behalf is done. Two tiny manual clicks remain (5 min total).

---

## What's live right now

- **Deployment**: `https://srmd-hub.vercel.app` (Vercel, team `akshay-srmd`)
- **Backend**: re-uses your existing `srmd-projects-hub` Supabase (all 120 indents, 139 POs, 121 GRNs, 118 invoices already there)
- **Build**: production build succeeded, all 24 routes compiled, no TS errors
- **Env vars on Vercel**: all 5 set (Supabase URL, anon key, admin email, attendance URL, app URL)
- **Auth gating works**: `/` → 307 to `/login`, `/login` → 200 OK
- **Local repo**: committed to `srmd-hub/` git with remote pointed at `github.com/projectexecution-ui/srmd-hub`

## What you need to do (2 clicks, ~5 min)

### 1. Add the new domain to Supabase Auth — REQUIRED to log in

Without this, Google sign-in will reject the redirect.

1. Open <https://supabase.com/dashboard/project/hjwtjrjkmuhhbsbjsqhx/auth/url-configuration>
2. Under **Site URL**, add: `https://srmd-hub.vercel.app`
3. Under **Redirect URLs**, add: `https://srmd-hub.vercel.app/auth/callback`
4. Save

Also make sure **Google** is enabled under **Authentication → Providers** for this project (same OAuth client as SiteAttend works fine).

### 2. (Optional) Create the GitHub repo

I couldn't auto-create the GitHub repo — my MCP integration doesn't have repo-creation permission on `projectexecution-ui`. Easy fix:

1. Go to <https://github.com/new>
2. Owner: `projectexecution-ui`, name: `srmd-hub`, **Private**
3. Click **Create repository** — leave it empty (no README, no .gitignore)
4. Open a terminal here and run:

```bash
cd "C:\Users\aksha\OneDrive\Documents\Cowork Playground\srmd-hub"
git push -u origin main
```

The remote is already configured. After this, every `git push` deploys automatically if you connect the repo to the Vercel project (Vercel dashboard → Settings → Git).

---

## What's running

| Module           | URL                                          | Status |
| ---------------- | -------------------------------------------- | ------ |
| Dashboard        | `/dashboard`                                 | ✅      |
| Indents          | `/indents`, `/indents/[id]`                  | ✅      |
| Purchase Orders  | `/pos`, `/pos/[id]` (+ PDF download)         | ✅      |
| GRN              | `/grns`, `/grns/[id]`                        | ✅      |
| Invoices         | `/invoices`, `/invoices/[id]`                | ✅      |
| Vendors (CRUD)   | `/vendors`                                   | ✅      |
| Projects (CRUD)  | `/projects`                                  | ✅      |
| Uploads (RO)     | `/uploads`                                   | ✅      |
| JMR (placeholder)| `/jmr`                                       | ✅      |
| Attendance       | external tile → siteattend.vercel.app        | ✅      |
| Admin → Users    | `/admin/users` (role + active toggle)        | ✅      |
| Admin → Settings | `/admin/settings` (admin_email)              | ✅      |
| Zoho             | excluded as requested                        | ❌      |

## Sanity check

After step 1 above, sign in at <https://srmd-hub.vercel.app> with **construction@srmd.org**. You should land on the dashboard and see:

- 120 indents, 139 POs, 121 GRN, 118 invoices in the stat strip
- Tile launcher with all modules
- Recent indents + POs feeding from your live data

## Files to look at if you want to tweak things

| File                                  | Why                                                |
| ------------------------------------- | -------------------------------------------------- |
| `lib/modules.ts`                      | Edit tile labels, descriptions, tones, role gates  |
| `lib/po-pdf.ts`                       | PO PDF letterhead / layout                         |
| `components/NavBar.tsx`               | Sidebar links                                      |
| `components/TileLauncher.tsx`         | Dashboard tile grid                                |
| `docs/INTEGRATIONS.md`                | Gmail / Drive / Scheduled Tasks plan for v2        |
| `SETUP.md`                            | Full deploy walkthrough (already done)             |

— Claude
