# SRMD Hub — Setup & Deploy

Everything you need to take this from local → live. Run this in the order shown.

---

## Prerequisites

You already have these — listed here for reference:

- **Supabase project**: `srmd-projects-hub` (id `hjwtjrjkmuhhbsbjsqhx`, region `ap-south-1`)
- **GitHub account**: `projectexecution-ui`
- **Vercel team**: `projectexecution-9357's projects`
- **Admin email** (already set in `app_settings`): `construction@srmd.org`

You do **not** need a new Supabase project, new Postgres, or new schema. This app reuses the existing one.

---

## Step 1 — Install + run locally (5 minutes)

```bash
cd srmd-hub
cp .env.local.example .env.local
npm install
npm run dev
```

Open <http://localhost:3000> → you should be bounced to `/login`.

The env file already points at the live Supabase. If you want to test against a sandbox first, change `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` before running.

---

## Step 2 — Make sure Google OAuth is enabled on Supabase

It's already enabled for the SiteAttend project; for `srmd-projects-hub` you'll need to add it too.

1. Supabase Dashboard → `srmd-projects-hub` → **Authentication → Providers → Google**.
2. Use the same OAuth Client ID + Secret as SiteAttend (Google Cloud Console → APIs & Services → Credentials).
3. **Authorized redirect URIs** on the Google OAuth client must include:
   - `https://hjwtjrjkmuhhbsbjsqhx.supabase.co/auth/v1/callback`
4. Supabase → **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000` (later replace with your Vercel URL)
   - **Redirect URLs**: add both `http://localhost:3000/auth/callback` and your future Vercel URL.

Now `Continue with Google` on the login page will work.

---

## Step 3 — Push to GitHub

```bash
cd srmd-hub
git init
git add .
git commit -m "feat: scaffold SRMD Hub — dashboard + Indent→PO modules"

# Create the repo (private recommended)
# (Use the GitHub UI or the gh CLI — credentials manager will prompt)
gh repo create projectexecution-ui/srmd-hub --private --source=. --push
```

If you don't have `gh`, create the repo manually at <https://github.com/new>, then:

```bash
git remote add origin https://github.com/projectexecution-ui/srmd-hub.git
git branch -M main
git push -u origin main
```

---

## Step 4 — Deploy to Vercel

1. <https://vercel.com/new> → import `projectexecution-ui/srmd-hub`.
2. Framework: **Next.js** (auto-detected).
3. **Environment Variables** (copy from `.env.local`):

   ```
   NEXT_PUBLIC_SUPABASE_URL      = https://hjwtjrjkmuhhbsbjsqhx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY = sb_publishable_By4r6YYHZnBcXWPjk8oKuw_K0gqam-a
   NEXT_PUBLIC_APP_URL           = https://srmd-hub.vercel.app   (or your custom domain)
   NEXT_PUBLIC_ADMIN_EMAIL       = construction@srmd.org
   NEXT_PUBLIC_ATTENDANCE_URL    = https://siteattend.vercel.app
   ```

4. Deploy. Copy the resulting URL.
5. Back in **Supabase → Authentication → URL Configuration**, add the new Vercel URL to **Site URL** and **Redirect URLs**.

---

## Step 5 — First sign in

Open the deployed URL on your phone or laptop. Sign in with **construction@srmd.org**. You become admin automatically (the `handle_new_user` trigger reads `app_settings.admin_email`).

After signing in:

- **`/admin/users`** — promote your team members to `uploader` or `admin`.
- **`/admin/settings`** — change the admin email if needed.
- **`/projects`** — add any missing project / site codes.
- **`/vendors`** — add any missing vendors.

---

## What is *not* wired yet (intentional)

These are pending v2; full integration notes in `docs/INTEGRATIONS.md`:

- **Gmail notifications** for new indents / approval requests
- **Google Drive** storage for signed PO PDFs and vendor quotations
- **Excel upload pipeline** in this new UI (existing tool at `srmd-hub.pages.dev` still handles this)
- **Payments** module — table exists, no UI yet (0 rows in DB)
- **JMR** module — placeholder tile only
- **Budget vs Actual** — placeholder tile only

---

## Sanity check — does the app see the live data?

After signing in, on the **Dashboard** you should see the rollups:

- Indents: 120
- Purchase Orders: 139
- GRN: 121
- Invoices: 118

If the numbers don't match, check:

1. The env vars match the project ref in `lib/supabase/client.ts` calls (open browser devtools network tab).
2. RLS policies for `viewer` role on those tables permit `select`. (They do — but worth confirming.)

---

## Local-dev tips

- This is **Next.js 16**, which renamed `middleware.ts` to `proxy.ts`. The file lives at the project root: `proxy.ts`. Don't try to add a `middleware.ts`.
- If you see a Supabase auth error after Google sign-in, your **Site URL** in Supabase doesn't match the URL the browser is on.
- `npm run dev` may take ~30 seconds first run while Tailwind v4 compiles.
