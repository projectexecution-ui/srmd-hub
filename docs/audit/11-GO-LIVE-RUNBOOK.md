# Go-live runbook — revamp → live CT Hub, one sitting, four phases (10 Sep 2026)

Aksha: "Lets do it — keep all revertible so if any issue we can go back to original Live before the revamp. **'simon go back'** is the code word for reverting all new revamp changes if anything has gone wrong and my CT Hub is stuck. Also give Admin a toggle to switch back to the previous CT Hub — name it, for internal use, **CT Hub V1**."

## Decisions taken in Phase 1

| Question | Aksha's answer | What it means in code / data |
|---|---|---|
| Engineers, viewers, CT OFC see IN4 rates (By order, WO / PO, Masters) | Keep — "all engineers are working in IN4, which they can access to; only management-level data should not be shown to anyone" | No tab switches. Management-level data = Internal Estimate, Approvals, Accounts, SC Budget, Paid / % Used for engineers — all already gated in code (10-ROLE-BY-ROLE.md §2) |
| Trustee and Mayank can edit the permission matrix | Admin only | Phase 2 data: `role_permissions` rows `founder` / `admin-permissions` and `backoffice` / `admin-permissions` → `can_edit = false` (view stays) |
| 28 "Anonymous" viewers | Leave for now, review after | Nothing today; review /admin/users next week |
| Atm Head IN4 notifications | On from day one | Nothing to set; the cron runs from `main` after the merge |
| Indent → PO tracker default | Live IN4 (chosen earlier, Step 12) | Nothing to set |

## The two ways back

| | CT Hub V1 (toggle) | simon go back (revert) |
|---|---|---|
| What it does | Everyone sees the previous CT Hub (old sidebar, old project pages, old Admin home, no work strip) on their next page load. The revamp code stays installed. | `main` goes back to the exact code it had before the merge. Vercel redeploys it. |
| Who / how | Any admin: Admin home → **CT Hub V1** card → *Switch to CT Hub V1*. Writes `app_settings.cthub_shell = 'v1'`. Undo: same card, *Back to the revamp*. | Claude, on the code word: `git revert -m 1 <merge sha>` on `main`, push; or Vercel → Deployments → previous production → *Instant Rollback*. |
| Time | Seconds, no deploy | 3–5 minutes (rollback: under a minute) |
| Use when | A screen is wrong or confusing and you want breathing room while it is fixed | The hub is stuck or erroring and the toggle is not enough |
| Data | Nothing changes | Nothing changes. The two additive Name-layer columns/tables stay; the pre-revamp code never reads them. `cc_accounts_users` and the two matrix rows from Phase 2 stay; harmless to the old code |

The trial deployment always shows the revamp, whatever the toggle says (`revampFromSetting` in `lib/revamp/live.ts`).

## Phase 2 — data on live, BEFORE the merge (nothing reads these rows until the new code is live)

1. Cost Control → Settings → **Who can open Accounts**: tick **Akshay Atmarpit** (`465e6bfe-b348-48d6-9346-836b0d444ec7`) and **Chirag Shah** (`d64adae2-429d-4879-a14a-c9efa98a16b5`). Until ticked, only admins see Accounts.
2. Permission matrix (or SQL): `head` → `procurement-tracker` → **View on**. Without it the four Atm Heads cannot open Indents or WO / PO — the approver screens.
3. Permission matrix (or SQL): `founder` → `admin-permissions` → **Edit off**; `backoffice` → `admin-permissions` → **Edit off**.

The matrix UI is the preferred way (it stamps `updated_by`). If done by SQL: plain `UPDATE … SET can_edit/can_view … WHERE role = … AND module_slug = …` — never an upsert with `do update` (see memory note on the seed footgun).

## Phase 3 — merge and deploy

```
git checkout main && git pull
git merge --no-ff revamp-trial -m "Revamp goes live (CT Hub V2) — see docs/audit/09, 10, 11"
git push origin main
```
Record the merge sha here: `__________` — it is what "simon go back" reverts. Vercel builds (≈3 min). The `in4-approvals` cron runs on the dispatcher's next slot and announces what is at Verify.

## Phase 4 — check together (20–30 min)

| As | Open | Expect |
|---|---|---|
| Aksha (admin) | Dashboard → Projects → any project | New pane; workspace with all built tabs; Accounts visible; Admin home shows the CT Hub V1 card |
| Akshay Atmarpit (head) | NGH → Indents, WO / PO, Accounts, SC Budget | Indents and WO / PO open (Phase 2 step 2); yellow badge if anything at Verify; Accounts visible (step 1); SC Budget visible |
| Amit Gala or Hiten (head) | same project → Accounts | **Not in the ribbon**; `/project/<id>/accounts` → 404 |
| Chirag (founder) | any project → Accounts, Approvals, Admin | Accounts visible; Admin → Permissions opens read-only (step 3) |
| Mayank | Admin → Permissions | Opens, cannot edit |
| Akshay Parekh (engineer) | project → Budget, Indents, WO / PO, Discussions, Masters | Engineer-safe Budget (no Internal Estimate, no Paid); no Approvals / SC Budget / Accounts / Reports; no [IB] comments in Discussions |
| Any viewer | Projects, Masters | Open; same money as the old screens, on one page |
| Anyone | Project setup | "Budget source: IN4" card with the last-run stamp |

If a check fails: small → fix on `main` in one commit; big → CT Hub V1 toggle; stuck → "simon go back".
