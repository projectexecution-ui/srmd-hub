# CT HUB — Revamp Audit Prompt Pack (v2, corrected 8 Sep 2026)

Purpose: audit the **revamp trial site** (`revamp-trial`, Vercel Preview) thoroughly and produce a written backlog. The revamp **stays a separate site**. Live (`main`, ct-hub.vercel.app) is not touched and there is no cutover. Fable does only the thinking that needs Fable; cheaper models do the typing.

## What changed from v1 — read this, it changes the audit

These were checked on 7–8 Sep 2026 against the actual branches, not assumed:

| v1 assumed | What is true | Effect |
|---|---|---|
| Revamp might read a different Supabase project | **Same project as live**: `hjwtjrjkmuhhbsbjsqhx` on both branches and in `.env.local` | P0-A #1 becomes a one-line confirmation, not a hunt |
| Some LIVE routes may be missing on REVAMP; four report modules were removed | **Nothing was removed.** `revamp-trial` = `main` + 63 commits. 168 pages vs 158, 72 API routes vs 71, all differences are additions. Budget, Procurement Tracker, Contractor Report, Supplier Report are all still present | The parity matrix has no "missing" rows. Deliverable 01 becomes a review of the **new** routes instead |
| Revamp may carry schema changes | **No migrations** on revamp that are not on main | No DB-drift work; the confirmation rule's DB clause should not fire |
| Audit RA-bill cumulative / carry-forward / advance-recovery logic | **No such engine exists** in CT Hub. JMR bills were removed July 2026; Bills Booking is a stage tracker. Only the Contractor Report *displays* Zoho's Deductions / Retention columns | Replaced with the money paths that actually compute (listed in P0-B) |
| Cutover phase (Prompt D) | **Not wanted.** Revamp stays separate | Prompt D removed |
| — | The trial site shares the LIVE database and is kept read-only by `proxy.ts` (refuses non-GET, blocks cron paths) via `IS_DEMO` / `NEXT_PUBLIC_DEMO_MODE`. That block is **by design and stays** | The audit's most important P0 is now: *can the trial site write to the live database by any path?* |
| Phase 0 in bash | PowerShell 5.1 script `phase0-inventory.ps1`; reads branches with `git ls-tree` (no checkout), includes `route.ts`, greps with `git grep` (`rg` is not on PowerShell's PATH, and v1's `--type tsx` does not exist — that grep errored and wrote empty files) | Inventory files are actually populated |
| RLS / row counts / policies done by Fable | Moved to `phase0-readonly.sql` — they are SQL, not reasoning | Fable's file budget goes on judgement |

---

## 1. Credit strategy

| Phase | Model | What happens | Why |
|---|---|---|---|
| 0. Inventory | Free | Run `docs/audit/phase0-inventory.ps1`, then `phase0-readonly.sql` in the Supabase SQL editor | Never pay a model to `ls`, `grep` or `count(*)` |
| 1. Deep audit | **Fable** — 1 long run | Prompt A. Read-only. Produces 4 markdown files | Cross-module reasoning is what Fable is for |
| 2. Fixes | Sonnet 5 / Opus 5 | Prompt B, one batch per session | Executing an unambiguous written task is cheap work |
| 3. Delta re-audit | Sonnet 5 | Prompt C | Only re-checks what changed |

Rules that save the most credits:
- **The audit run writes zero code.** Mixing audit + fix in one Fable session burns the window and loses the findings.
- `/clear` between every phase. Findings live in files, not chat.
- Never paste large files into chat. Point at paths.
- Cap file reads (Prompt A says 60). An uncapped audit reads the repo twice.
- If the model changes mid-session, note it in the deliverable and continue.

Branch names are fixed: **LIVE = `main`**, **REVAMP = `revamp-trial`**.

---

## 1A. Standing rule — nothing significant happens without my confirmation

Repeated inside every prompt below. Keep it there when editing them.

```
CONFIRMATION RULE — applies to this entire session, no exceptions.
STOP and ask me before doing any of the following. Show me exactly what you
propose to change and why, in plain language, then WAIT for my explicit yes.
  - Any database change: migration, schema edit, new table or column, RLS policy,
    index, or any write to Supabase
  - Anything that touches lib/in4/, the sync, or the cron schedule
  - Deleting or renaming any route, page, module, component or lib file
  - Changing any business rule or formula — quantities, rates, amounts, retention,
    budget, estimate or approval logic
  - Auth, roles, permissions, or anything affecting who can see what — including
    the Internal Estimate, which is management-confidential
  - Removing or weakening the trial site's read-only guard (IS_DEMO / proxy.ts)
  - Adding, removing or upgrading a dependency
  - Any env var change, or anything touching Vercel config
  - git push to any branch OTHER than revamp-trial; any merge, branch deletion or tag
  - Anything at all on the main branch or the production deployment
  - Any work outside the specific batch or scope I named in this prompt
Pushing to revamp-trial after `next build` and the test suite both pass is ALLOWED
without asking — it is the only way I can see the result on the trial site, and the
trial site cannot write to the database.
How pre-approval works: at the start of a batch, list every item that would trigger
this rule. I approve or defer each one by name, in one reply. Those named approvals
hold for that batch only. Anything that comes up mid-batch that is NOT on the list
gets its own ask — one decision, one ask.
If you are unsure whether something is significant, it is. Ask.
Never proceed on an assumption about my business intent; ask or file it as a QUESTION.
```

---

## 2. Phase 0 — free inventory (PowerShell, no model)

From the repo root:

```powershell
.\docs\audit\phase0-inventory.ps1
```

It writes to `docs/audit/`: `routes-live.txt`, `routes-revamp.txt`, `routes-diff.txt`, `branch-shape.txt`, `diffstat.txt`, `migrations-diff.txt`, `supabase-target.txt` (hosts only, never keys), `smells.txt`, `env-and-db.txt`, `numeric.txt`, `demo-mode.txt`, `in4-queries.txt`, `in4-write-keywords.txt`, `get-handlers.txt`.

Then open `docs/audit/phase0-readonly.sql` in the Supabase SQL editor, run each block, and paste the results into `docs/audit/db-inventory.txt`. Every statement is a SELECT.

`numeric.txt` and `get-handlers.txt` matter most: rounding bugs hide in the first, and the second lists the only handlers the trial site's method gate cannot stop.

---

## 3. Prompt A — Fable deep audit

> Paste as-is into Claude Code on `revamp-trial`. One run.

```
You are auditing CT HUB, a Next.js + Supabase construction project management
platform for SRMD (Dharampur, Gujarat). Three trusts pay for works — SRASSK, SRA and
SRET — and appear as separate paying companies in IN4. I am the sole owner and PM.

CONTEXT — these are verified facts, not things to discover
- Two deployments share ONE Supabase project, hjwtjrjkmuhhbsbjsqhx:
    LIVE   = branch main, ct-hub.vercel.app, in daily use by site and procurement staff
    REVAMP = branch revamp-trial (this working directory), a Vercel PREVIEW deployment
- REVAMP is main + 63 commits. Nothing has been removed. It has no migrations that main
  lacks. It stays a separate trial site; there is no plan to merge it into main.
- REVAMP is held read-only against the shared database by proxy.ts: every non-GET
  request is refused and the cron paths are blocked, switched on by IS_DEMO /
  NEXT_PUBLIC_DEMO_MODE. That guard is BY DESIGN and stays. Its correctness is P0.
- IN4 is the site ERP (SQL Server). CT Hub reads it two ways: (a) a scheduled sync that
  mirrors IN4 into in4_* tables in Supabase — writes to THOSE tables from lib/in4 are
  expected and correct; (b) direct read-only SELECTs through in4Query() for the printed
  work order. The IN4 login is read-only at the server. Nothing may send anything but
  SELECT down in4Query().
- Excel uploads are NOT legacy. The weekly BPH export → /budget and the budget workbook
  upload are current paths because that IN4 feed has no API. Do not file them as
  findings for existing; file only cases where an upload can silently overwrite a
  synced value.
- Internal Estimate is management-confidential. It must never reach the engineer role
  or any cost-control "view"-only role. It leaked once on this branch already and was
  fixed; treat any new exposure as P0.
- Pre-computed inventory is in docs/audit/ — routes-diff.txt, branch-shape.txt,
  diffstat.txt, migrations-diff.txt, supabase-target.txt, smells.txt, env-and-db.txt,
  numeric.txt, demo-mode.txt, in4-queries.txt, in4-write-keywords.txt,
  get-handlers.txt, db-inventory.txt. READ THOSE FIRST and use them to target reads.

HARD RULES
1. READ-ONLY on source code. Do not edit, refactor or fix anything. Your only writes
   are the four deliverable files in docs/audit/.
2. Read-only SELECTs against Supabase are permitted and expected. Nothing else touches
   the database. Nothing touches IN4 beyond what you read in code.
3. Budget: open at most 60 source files. If you hit the cap, say so and list what you
   did not reach.
4. Every finding cites file path + line number. No finding without evidence.
5. If unsure whether something is a bug or intentional, file a QUESTION, not a finding.
6. CONFIRMATION RULE — this run is read-only so it should not arise, but if you believe
   any action outside "read files, run SELECTs, write the four deliverables" is
   necessary, STOP and ask me first. If unsure, it is significant. Ask.

AUDIT SCOPE — in this order

P0-A — THE TRIAL SITE MUST NOT WRITE TO THE LIVE DATABASE
  1. Confirm in one line, from supabase-target.txt and the client setup in code, that
     REVAMP reads hjwtjrjkmuhhbsbjsqhx. Do not investigate further.
  2. Read proxy.ts and lib/demo-mode.ts. State exactly what is blocked and how the
     flag is derived. Confirm the tests in lib/demo-mode.test.ts cover the production
     case (VERCEL_ENV=production, flag empty → false).
  3. get-handlers.txt lists every GET route handler. The method gate cannot stop a GET.
     For each one, state whether it can write (insert/update/delete/rpc that mutates)
     or send (email, Telegram). Any GET that writes or sends on REVAMP is P0.
  4. Server actions: find every 'use server' function reachable from a REVAMP-only
     screen. Confirm each is behind the proxy gate (they are POSTs) — if any can be
     invoked another way, P0.
  5. IN4 read-only: from in4-queries.txt, confirm every in4Query() call is a SELECT.
     in4-write-keywords.txt will show insert/update/delete in lib/in4/feeds.ts and
     sync.ts — those are sb.from() writes to the Supabase mirror and are EXPECTED. Only
     a non-SELECT reaching in4Query() is a finding.
  6. BOQ join: confirm any code joining WO BOQ data uses WO_ID + ITEM_ID, never BOQ_ID.
     Verify on WO 623, item 6340 — expected 57,775.06 of 60,707.15 SqFt = 95.17%.
  7. From db-inventory.txt: report the in4_* counts against the 6 Sep mirror baseline
     (projects 36 + sub 123, indent lines 4,914, work orders 1,666, wo_boq_items 9,852,
     wo_abstract_items 8,230) and the last sync time. On 8 Sep the mirror read 36 / 123 /
     4,963 / 1,670 / 9,856 / 8,237, last synced 03:51 UTC (09:21 IST) — all at or above
     baseline. The mirror is SHARED with live, so staleness is not a REVAMP defect —
     report it, do not file it. IN4 itself holds more rows than the mirror (2,157 work
     orders); that gap is expected.
  8. PO / GRN: on 8 Sep, 4,664 PO entries and 4,535 GRN entries exist ONLY nested inside
     in4_indent_items.pos / .grns; there is no standalone in4 PO or GRN table. State which
     REVAMP screens are therefore incomplete: a PO not raised from an indent is
     invisible, a GRN cannot be opened on its own. Do not re-derive the counts.
  9. RLS: db-inventory.txt shows RLS ON for every public table, and the anon role holding
     every table-level privilege. The second is Supabase's DEFAULT grant and is NOT a
     finding — RLS decides. What IS a finding: a policy whose roles include anon or
     public, or a non-SELECT policy whose USING / WITH CHECK is literally true. The
     inventory lists both; verify them, do not rediscover them.

P0-B — MONEY. These are the paths that actually compute figures:
  - Contractor Report roll-ups: Balance = Bill − Paid − Deductions − Retention; Total
    Owed = Balance + Retention. Check subtotal and grand-total arithmetic and the
    Excel/PDF export columns against the on-screen ones.
  - Budget vs Actual V2: Budget · Approved · Paid · Balance · Used% from the budget
    report alone. Check float arithmetic on money and rounding at display.
  - Cost Control: request amounts, cross-category transfers, "Completed" closing a
    line, and the Internal Estimate check figures in docs/REVAMP-BUILD-ORDER.md — the
    doc's own estimate (₹1) and WO/PO (₹22,562) figures are known to be wrong; check the
    code, not the doc.
  - The WO/PO orders tree (lib/revamp/orders-tree.ts): category / sub-category / order
    sums, and that "no derived figures" holds — a column shows what IN4 holds or n/a.
  - The printed work order (lib/in4/wo-print.ts): gross value from WO_GROSS_VALUE, not
    WORK_ORDER_VALUE; never substitutes inside IN4's own bracketed text.
  - Any user action that can overwrite or contradict an IN4-synced value.
  - Any service_role key or token reachable from client code (env-and-db.txt).
    RLS itself is covered under P0-A #9.

P1 — NEW ROUTES AND CHANGED SHARED CODE
  - routes-diff.txt lists every route new on REVAMP. For each: who can reach it (compare
    to the permission it should carry), does it degrade cleanly when IN4 or Supabase is
    unavailable, does it have loading and empty states, does it work at 375px.
  - diffstat.txt shows which SHARED files the 63 commits changed (NavBar, ProjectTree,
    cost-control project page, tree components). A regression there affects every screen
    on the trial site. Check for dead actions, broken links, handlers that no-op.
  - Mobile is P1 here, not P2: site staff use phones. Page-level position:sticky is
    inert app-wide (main sets overflow-x-auto) — flag any new use of it.

P2 — RELIABILITY
  - Unhandled rejections, missing error boundaries, missing loading/empty states.
  - N+1 Supabase queries and unbounded selects. PostgREST caps at 1,000 rows silently —
    flag any read of a growing table without paging (indents, POs, BOQ items, JMR).
  - Formatting: every rupee figure through formatINR / Indian grouping, every date in
    IST via the shared helpers. Flag raw toLocaleString / new Date().toString().

P3 — HYGIENE
  - Dead code, unused deps, duplicated logic, @ts-ignore, any-typing on domain models.
  - Env vars REVAMP needs that main does not (the IN4_* set at least) — list them.

SEVERITY
  P0 wrong money, data written from the trial site, or exposed / confidential data
  P1 a new or changed screen that does not work, or excludes phones
  P2 degrades usability or performance
  P3 backlog

DELIVERABLES — write exactly these four files, nothing else
1. docs/audit/00-SUMMARY.md — max 1 page, written for a phone. Open with a TRIAL-SITE
   SAFETY block in six lines: database project; write-guard holds yes/no; GET handlers
   that write (count); IN4 read-only yes/no; mirror counts vs baseline; last sync.
   Then counts by severity and the three things that worry you most, in plain language.
2. docs/audit/01-NEW-ROUTES.md — one row per route new on REVAMP: route | who can reach
   it | IN4 dependency | mobile OK | empty/loading states | risk.
3. docs/audit/02-FINDINGS.md — one block per finding:
     ID (F-001…) | Severity | Module | file:line | Status: OPEN
     What is wrong (2 sentences max)
     Why it matters in construction terms
     Suggested fix (2 sentences max, no code)
     Effort: S / M / L
4. docs/audit/03-BACKLOG.md — the findings as a flat checklist ordered for execution,
   grouped into batches a single non-Fable session can finish, each item self-contained.
   End with an open QUESTIONS section for me.

Work in priority order. If you run low on context, write the deliverables covering what
you completed — a complete P0 beats a half-written full audit — and state what remains.
```

---

## 4. Prompt B — fix execution (Sonnet 5 / Opus 5, one batch per session)

```
Read docs/audit/02-FINDINGS.md and docs/audit/03-BACKLOG.md.
Implement ONLY batch {{N}}. Do not touch anything outside it.
Branch: revamp-trial. Never main.

[paste the CONFIRMATION RULE block from §1A here, unchanged]

Before you start: list the items in batch {{N}} and mark which ones trigger the
confirmation rule. I will approve or defer each by name in one reply. Proceed with the
approved ones and the ones that need no approval; skip the deferred ones.

For each item: make the minimal change, then state what changed and how I verify it on
the trial site in one step. If an item's intent is unclear, skip it and add it to
QUESTIONS rather than guessing.

When the batch is done: run `npx vitest run` and `npx next build`. Both must pass before
any push. Then push to revamp-trial, tick the items in 03-BACKLOG.md, set their Status
in 02-FINDINGS.md to FIXED, and append a short entry to docs/audit/CHANGELOG.md.
Report any new build or test errors verbatim.
```

---

## 5. Prompt C — delta re-audit (Sonnet 5)

```
Re-audit ONLY the P0 and P1 findings in docs/audit/02-FINDINGS.md whose Status is FIXED.
For each, confirm it is genuinely fixed at the cited file:line and that the fix
introduced no new issue in the same file. Read only those files. Set Status to
VERIFIED / NOT-FIXED / REGRESSED with one line of evidence.
Do not open new audit scope. This is read-only apart from editing 02-FINDINGS.md.
Do not fix anything you find, even a one-line fix — report it and wait for my yes.
No git operations, no database writes, nothing on main.
```

---

## 6. Working rhythm

Run Phase 0 (free) and Prompt A once. Read only `00-SUMMARY.md` yourself. If the TRIAL-SITE SAFETY block says the write guard does not hold, that is the only thing to fix before anything else. Then work batches with Prompt B at whatever pace site work allows, re-running Prompt C every few batches.

If the audit raises business-logic questions (how a Contractor Report figure should treat a Zoho revision, whether an Excel upload should ever win over a synced value), bring those to me in chat — those are decisions, not code.

If the decision to keep the revamp separate changes later, a cutover phase can be added back — but it would need one thing v1 did not have: the `IS_DEMO` flag currently does two jobs (blocks writes AND shows the revamp navigation), and those would have to be split first.
