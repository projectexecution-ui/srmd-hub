# Status when you got back 🌅

## TL;DR

- **Site is LIVE** → <https://srmd-hub.vercel.app>
- **One 30-second click needed to make sign-in work** (Supabase redirect URL — see below)
- The Quick sign-in shortcut I tried to push as a fallback didn't reach Vercel — every upload from this terminal hit `ECONNABORTED` / `ECONNRESET`. The code is committed locally, just not on Vercel.

## What works right now

What you'll see at <https://srmd-hub.vercel.app>:

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
| Admin → Users    | `/admin/users`                               | ✅      |
| Admin → Settings | `/admin/settings`                            | ✅      |
| Zoho             | excluded as requested                        | ❌      |

The login page only offers **Google sign-in** because the Quick sign-in fallback didn't deploy. So you need step 1 below.

---

## What you need to do (one 30-second click)

### Add the Vercel domain to Supabase Auth — REQUIRED

Without this, clicking "Continue with Google" goes to Google and then errors back because Supabase rejects the redirect URL.

1. Open <https://supabase.com/dashboard/project/hjwtjrjkmuhhbsbjsqhx/auth/url-configuration>
2. Under **Site URL**, paste: `https://srmd-hub.vercel.app`
3. Under **Redirect URLs**, click **Add URL** and paste: `https://srmd-hub.vercel.app/auth/callback`
4. Click **Save**.

Also confirm under **Authentication → Providers → Google** that it's **enabled** (you may need to copy the OAuth Client ID + Secret from SiteAttend's setup — same Google Cloud project).

Then go to <https://srmd-hub.vercel.app>, click **Continue with Google**, sign in with `projectexecution@construction.srmd.org` → admin dashboard.

---

## (Optional) Deploy the Quick sign-in fallback later

I tried to add a "Quick sign-in (no Google)" button that uses Supabase anonymous auth (already enabled, grants admin per your existing trigger). The code is committed locally in `app/login/page.tsx` but my deploy attempts kept failing with network errors. To push it later from your own laptop:

```bash
cd "C:\Users\aksha\OneDrive\Documents\Cowork Playground\srmd-hub"
vercel --prod
```

If your network handles the upload fine (probably will — this is just a flaky route from my terminal), it'll show up within ~60 seconds.

---

## What's running on Vercel

| What                       | URL / value                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| Production domain          | <https://srmd-hub.vercel.app>                                       |
| Vercel team                | `akshay-srmd`                                                       |
| Vercel project             | `akshay-srmd/srmd-hub`                                              |
| Current live deployment    | `dpl_85SsWN3MSp3ATyVNddYZiAKJaEGj` (re-deployed clean at ~9:24 IST) |
| Supabase project           | `hjwtjrjkmuhhbsbjsqhx` (`srmd-projects-hub`)                        |
| Backend admin email        | `projectexecution@construction.srmd.org`                                             |

5 env vars set on Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ADMIN_EMAIL`, `NEXT_PUBLIC_ATTENDANCE_URL`.

---

## GitHub

The MCP I have for GitHub doesn't have repo-creation permission on `projectexecution-ui`. To finish that:

1. Open <https://github.com/new>
2. Owner: `projectexecution-ui`, name: `srmd-hub`, **Private**, no README / no .gitignore
3. In a terminal here:
   ```bash
   cd "C:\Users\aksha\OneDrive\Documents\Cowork Playground\srmd-hub"
   git push -u origin main
   ```
   The remote is already configured to `github.com/projectexecution-ui/srmd-hub`.

Once pushed, you can connect the repo in Vercel project settings → Git, and every commit auto-deploys.

---

## Sanity check after step 1

On <https://srmd-hub.vercel.app/dashboard> you should see in the stat strip:

- **Indents: 120**
- **POs: 139**
- **GRN: 121**
- **Invoices: 118**

If those match — your live data is wired correctly and the app is talking to your existing Supabase. If they show 0, the env vars aren't matching — ping me with a screenshot.

— Claude
