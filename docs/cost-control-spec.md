# SRASSK Cost Control — Master Build Specification

> **For:** Claude Code (or a hired developer)
> **From:** Mayank Khandelwal, SRASSK Construction
> **Project name:** SRASSK Cost Control (working title)
> **Version:** v2.1 (incorporates Working Sheets, duplicate detection, hierarchy, admin-configurable permissions, deferred-setup wizard)
> **Adapted for srmd-hub:** This module lives inside the srmd-hub app at `/cost-control` rather than as a separate Next.js project. It reuses the hub's auth, profiles, modules registry, and admin/permissions infrastructure.

---

## 0. WHAT YOU ARE BUILDING — read this first

A web + mobile app that replaces 18 fragmented Excel files and scattered WhatsApp approvals with a single audited database. The system already has 80% of its design proven — the team has been using a consistent "ENGG_CONSOLIDATED_BUDGET_REPORT" schema across 18 projects (₹104 Cr portfolio). Your job is to put that proven schema into a real database with proper workflow on top, not to invent a new design.

**Non-negotiable principles** — every implementation choice must respect these:

1. **Event log, never overwrite.** Every change to money is an immutable row in `budget_events`. Current totals are always computed `SUM(events)`. This makes reconciliation errors mathematically impossible.
2. **Three numbers everywhere.** Every budget line has Budgeted / Committed (WO/PO) / Paid as three separate columns. Never collapse them.
3. **Material vs Work as a tag, not duplicate rows.** Your sheets currently duplicate (03 Civil, 03 (M) Civil). In the app, one row with a `type` field.
4. **Excel never dies — it just stops being the source of truth.** Engineers will keep getting bills/quotes in Excel forever. The app must ingest, never reject.
5. **Permissions are data, not code.** Admin must be able to change who-can-do-what without deploying code.
6. **Outsmart, don't trust.** Duplicate detection runs on every Working Sheet row in real-time, using three methods in parallel (text, semantic, triplet). Engineers can't rename or reword their way past it.
7. **Mobile first for approvers.** Heads approve from WhatsApp/Telegram, never from a desktop. Engineers can enter data on phone too.

---

## 1. TECH STACK (LOCKED — do not substitute)

| Layer | Choice | Reason |
|---|---|---|
| Framework | **Next.js 16 (App Router) + TypeScript** | Already in use in srmd-hub |
| Database + Auth + Storage + Realtime | **Supabase (Postgres)** | Already the hub's database (`srmd-projects-hub`) |
| UI components | **shadcn/ui + Tailwind v4** | Already in use |
| Excel parsing | **SheetJS (xlsx)** library | Handles the messy ENGG_CONSOLIDATED_BUDGET_REPORT format |
| Embeddings (for duplicate detection) | **OpenAI text-embedding-3-small** via Supabase Edge Function | 1536-dim vectors; cheap; works well for short construction descriptions |
| Vector search | **Supabase pgvector extension** | Native to Postgres; no separate service |
| Hosting | **Vercel** | Already in use |
| Bot — Phase 1 | **Telegram Bot API** | Free; inline buttons native |
| Bot — Phase 2 | **WhatsApp Business Cloud API** via Meta (or AiSensy as BSP) | ~₹0.16/utility msg in India |
| Notifications | **Resend.com** for email + native push later | Simple SMTP; good DX |
| File uploads (bills, drawings) | **Supabase Storage** | Bundled with DB |

**Do not introduce:** Firebase, MongoDB, Prisma, Material UI, Bootstrap, Express.js, any "construction ERP" SaaS, Auth0.

---

## 2. DOMAIN GLOSSARY (use these terms exactly — they're the team's working vocabulary)

| Term | Meaning |
|---|---|
| **Project** | A buildable parent (e.g. Raj Uphaar, SRAH, NGH) |
| **Sub-Project** | A buildable child (e.g. CFB under RU, NGH A under NGH). Has built-up Sft, budget, owner |
| **Discipline / Work Category** | One of 35 numbered categories (01 Site Pre-lims through 35 Kitchen). 19 are commonly used. Each has a 2-digit code |
| **Sub-Skill / Sub Work Category** | A 3-digit sub-category under a discipline (e.g. 302 Steel Works under 03 Civil) |
| **Material / Work split** | Same discipline split into procurement (M-prefix) vs labour. Stored as `type` enum, not duplicate row |
| **Rs/Sft** | Cost per built-up square foot — the metric management requests. Auto-computed from project sft |
| **BOQ** | Bill of Quantities — the contractor's itemized list with rates |
| **WO / PO** | Work Order (services) or Purchase Order (materials) — commits budget to a vendor |
| **Budget Shift** | Moving money between line items. Always atomic (negative on source + positive on destination) |
| **Working Sheet (WS)** | An engineer's itemized worksheet asking for approval. Has its own ID like WS-2026-0142. Items get aggregated into one approval request |
| **Past Items** | The canon — every previously-approved line item under a Sub-Skill, used as the reference for duplicate detection |
| **V-revision** | Version label like V47 — your team marks budget changes as V1, V2, V3... up to V52. Each is one or more `budget_events` |
| **Approval** | A pending decision routed to a Head. Can be for: a new Working Sheet, a Budget Shift, a Bill, a WO issuance, or a Rate change |

---

## 3. USER ROLES & HIERARCHY (built-in, but every flag editable by Admin)

Six built-in roles. Each role is a **default permission set**, but Admin can override any flag for any individual user via the Permissions admin screen.

### 3.1 The roles

| Role | Typical person | Default scope |
|---|---|---|
| **Founder** | Pujya MA | All projects, all disciplines. Final approval authority. Sees everything. |
| **Head** | KK, MA | Specific disciplines they oversee (Civil, MEP, Finishes...). Approves Working Sheets and Budget Shifts in their disciplines |
| **Project Manager (PM)** | MA (when running a project) | All disciplines but only on assigned projects. Creates projects, assigns engineers, configures categories |
| **Engineer** | CT, Ambrish | Assigned project(s) + assigned discipline(s). Creates Working Sheets, raises approvals, enters bills |
| **Accounts** | Accounts team | Read all + enter Bills and Payments only. Cannot create Working Sheets, cannot approve |
| **Viewer** | Trustees, auditors | Read-only across assigned projects. No edit anywhere. Useful for board oversight |
| **Contractor** *(optional, Phase 2)* | Sankalp, Desai, RJB | Read-only access to their own WOs and bills. Submit invoices for review |

### 3.2 The hierarchy (approval routing)

```
Founder (Pujya MA)
  ↑ (escalation above ₹X threshold — Admin sets ₹X per discipline)
Head (KK for MEP, MA for Civil, etc — Admin assigns)
  ↑ (Working Sheet / Budget Shift / Bill > ₹Y — Admin sets ₹Y per discipline)
Project Manager (per project)
  ↑ (Working Sheet creation, vendor onboarding — auto-routed)
Engineer (per project, per discipline)
  ↑ (Site bill entry — accounts route)
Accounts (enters paid amounts)
```

**Approval thresholds are configurable per discipline.** E.g.:

- Civil: Engineer can submit, Head approves up to ₹5L, Founder approves above
- Electrical: Engineer can submit, Head approves up to ₹2L, Founder approves above
- Site Admin: Engineer can self-approve up to ₹25k, Head above

Admin configures these in **Settings → Approval Thresholds**.

### 3.3 The permission matrix (this is the model — every cell editable by Admin)

For each role, against each resource type, Admin can flip these flags:

| Flag | What it means |
|---|---|
| `can_view` | Sees the resource in lists and detail views |
| `can_create` | Can create new instances |
| `can_edit_draft` | Can edit while in DRAFT status |
| `can_submit_for_approval` | Can move from DRAFT → SUBMITTED |
| `can_approve` | Can approve a SUBMITTED resource |
| `can_reject_return` | Can reject/return for revision |
| `can_edit_after_approval` | Can edit even after APPROVED (Founder/Head only) |
| `can_delete` | Can delete (rarely granted; usually only Admin) |
| `can_override_duplicate` | Can submit a flagged duplicate with reason |
| `can_export` | Can download Excel/PDF |
| `can_assign_users` | Can add/remove people from a project |
| `can_configure_categories` | Can add/disable disciplines or sub-skills on a project |
| `can_view_other_projects` | Can see projects they're not assigned to |
| `can_view_audit_log` | Can read the audit trail |
| `can_manage_vendors` | Can add/edit vendor master |
| `can_change_rates` | Can update item rate cards |

Resources the flags apply to: `Project`, `Working Sheet`, `Budget Event`, `Approval`, `Bill`, `Vendor`, `User`, `Discipline`, `Sub-Skill`, `Rate Card`.

**Admin** = a role with all flags = true on all resources. There must be at least 2 Admins at all times (no single point of failure). System refuses to remove the last Admin.

---

## 4. PROJECT SETUP WIZARD (Mayank's specific requirement)

When a new project is created, **do not force the PM to configure all categories upfront**. Instead:

### Step 1 — Project Basics (mandatory, 30 seconds)

- Project name (e.g. "NGH D")
- Parent project (NGH) — dropdown of existing
- Built-up Sft
- Approved budget (initial)
- Project Manager (assign 1 person)
- Start date, target completion

→ **Click "Create Project"** — project exists in DB with status `SETUP_INCOMPLETE`.

### Step 2 — Select Applicable Disciplines (encouraged but not blocking)

- Show all 35 disciplines as cards with checkboxes
- Pre-tick "common 19" (the disciplines almost every building uses: 01, 02, 03, 04, 05, 06, 07, 08, 09, 11, 12, 13, 17, 19, etc.)
- PM unticks the ones not applicable (e.g. Kitchen 35 not needed for a parking project)
- "Save and Continue" or "Skip — I'll do this later"

### Step 3 — Select Sub-Skills per Discipline (the part that takes time)

- For each ticked discipline, show its sub-skills as a checklist
- Default: all sub-skills pre-ticked
- PM unticks irrelevant ones
- "Save Discipline" button per discipline — saves partial progress
- Big "Skip All — Configure As I Go" button at the bottom

### Step 4 — Assign Engineers (optional at setup; can do later)

- Pick one or more engineers
- For each, select the disciplines they own on this project
- "Save and Open Project"

### Persistent Setup Reminder

After setup, the project dashboard shows a **soft yellow banner** if any of these are incomplete:

```
⚙ Setup is 60% complete — finish anytime
  ✓ Basics filled
  ✓ Disciplines selected (15 of 35)
  ⚠ Sub-skills configured for 8 of 15 disciplines
  ⚠ Engineers not assigned for 07 Electrical, 12 Finishes
  [Continue Setup →]  [Remind Me Tomorrow]  [Skip]
```

The banner does **not** block any work. Engineers can start creating Working Sheets in configured disciplines while PM finishes configuring the rest.

### "Add Discipline/Sub-Skill Anytime" buttons

Place a **"+ Add Discipline to Project"** button:

- On the project detail page (next to disciplines list)
- On the Working Sheet creation flow (if engineer picks a discipline that's not configured for this project, prompt PM in real-time)
- On the Settings → Project Configuration page

Same for sub-skills. Never make the user navigate away to add a missing category. Inline-add everywhere.

### What happens when an engineer tries to create a Working Sheet under an unconfigured sub-skill?

- Soft warning: *"08 Plumbing → 802 Water Lines isn't configured for this project yet."*
- Two buttons: **"Request PM to enable"** (sends notification to PM, Working Sheet saved as DRAFT_BLOCKED until enabled) or **"I'll pick a different sub-skill"**.
- Never silently fail. Never hard-block.

---

## 5. THE WORKING SHEET (the engineer's working artifact)

This is the most important screen in the entire app. Read carefully.

### 5.1 Anatomy

A Working Sheet is **scoped to one Sub-Skill on one Sub-Project**. E.g. "Admin Block / 12 Finishes / 1209 Painting". It contains a table of line items (rows) that the engineer is asking to be approved.

Each row has:

- Sr (auto)
- Item Description (free text, but checked against past items)
- UOM (dropdown: Sft, Rm, Cum, Nos, MT, Kg, Ls, etc.)
- Qty (number)
- Rate (₹/UOM, number)
- GST% (dropdown: 0, 5, 12, 18, 28)
- Amount (computed: qty × rate × (1 + gst/100))
- Vendor (dropdown from vendor master, with "+ Add new" option)
- Remark (free text)
- Duplicate Status (system-computed: none / low / medium / high / overridden)
- Location/Area tag (optional but encouraged: "Block A corridor", "MA cabin", "Conference room")

### 5.2 Statuses (state machine)

```
DRAFT  ──► SUBMITTED  ──► APPROVED  ──► WO_ISSUED  ──► PAID
   │            │             │
   │            └─► RETURNED ─┴─► (back to DRAFT)
   │
   └─► DRAFT_BLOCKED (waiting on PM to enable a category)
```

- **DRAFT** — engineer is editing. Anyone with edit permission on this WS can change it.
- **SUBMITTED** — sheet is LOCKED. Only Head/Founder can edit (with reason). Engineer sees read-only.
- **APPROVED** — Head has approved. Becomes the basis for a WO.
- **RETURNED** — Head returned with comments. Back to DRAFT for engineer.
- **WO_ISSUED** — A Work Order has been raised against this WS. Commitment is locked into budget.
- **PAID** — Bills against this WS are 100% paid.

### 5.3 Duplicate detection — the 3-layer defense

When the engineer types in the Description field, run three checks in parallel against the "Past Items" canon (all previously-approved line items under the same Sub-Skill on the same Sub-Project, and optionally across all projects):

**Layer 1 — Lexical similarity** (instant, client-side)

- Lowercase, strip punctuation, sort tokens, compute Jaccard similarity
- Flag if > 0.85
- Catches typos, word reordering

**Layer 2 — Semantic similarity** (debounced, server-side)

- 500ms after typing stops, embed the description via OpenAI
- Cosine similarity against all past item embeddings (pgvector query)
- Flag if cosine > 0.75
- Catches synonyms, rewording ("Distemper application" ≈ "Wall painting work")

**Layer 3 — Structured triplet match** (instant, on UOM/Vendor change)

- If `Sub-Skill + UOM + Vendor + Location tag` matches any past item exactly → flag as "Possible Continuation" (not necessarily a duplicate, but worth asking)

### 5.4 Flag levels & engineer response options

| Match score | Flag | Engineer can |
|---|---|---|
| Lexical > 0.95 OR semantic > 0.90 | **🚫 HIGH (95% match)** — red row | (a) Remove row, (b) Link as Continuation, (c) Override with structured reason |
| Lexical 0.85–0.95 OR semantic 0.75–0.90 | **⚠ MEDIUM (78% match)** — orange row | Same three options |
| Triplet match only | **💡 POSSIBLE CONTINUATION** — blue tip | Acknowledge or Override |
| All checks pass | **— OK** | Proceed |

### 5.5 The override reason — structured, not free text

When engineer chooses Override, present a **2-step form**:

**Step 1 — Pick a reason category** (dropdown):

- "Different physical location/area"
- "Different specification (material/quality/finish)"
- "Different stage of work (e.g. patching vs full paint)"
- "Quantity revision based on actual measurement"
- "Vendor change with different scope"
- "Other (must explain in detail)"

**Step 2 — Free text justification** (mandatory, min 30 characters):

- Must include specifics (which drawing, which room, why)
- Saved to `budget_events.override_reason` with category tag
- Visible to Head when reviewing, in audit log, and on WhatsApp/Telegram approval message

### 5.6 Locking & Head edit flow

Once **SUBMITTED**:

- Sheet UI changes to read-only for everyone except Head
- Yellow lock banner at top
- Head (or Founder) can click "Edit as Head" → cells unlock for them only
- **Every edit by Head requires a reason** — clicking any cell to edit pops a small dialog:

  ```
  "Change description for Item 3?"
  Reason for change: [______________________]
  [Cancel] [Save change]
  ```

- Reason is logged to audit and notified to original engineer (CT)
- Head can also: change qty/rate, remove rows, add rows, change vendor — each requiring its own reason

### 5.7 Smart features (these are what makes it "smart" beyond Excel)

| Feature | Behavior |
|---|---|
| Past-spend context | Above the table, always show: "Past approved in this sub-skill: ₹X.XX L · 6 items · last approval Date" |
| Rate auto-suggest | When engineer types description, system suggests rate based on most recent 3 approvals for similar items (vendor-weighted) |
| Vendor auto-suggest | Same — based on past use frequency in this sub-skill |
| Quantity reasonableness | If new qty is >2× the average past qty for same description, flag "⚠ Quantity seems high vs past" |
| Budget headroom | Bottom-right always shows: "Sub-skill budget: ₹X · Already committed: ₹Y · This WS will use: ₹Z · Remaining after: ₹W" — if W < 0, red banner |
| Drawing/photo attachments | Each row can attach photos or drawing snippets (Supabase Storage) |
| Continuation link | "Link to past item" creates a `wo_continuation` relationship — auto-fills rate from prior WS |

---

## 6. DATABASE SCHEMA (Supabase / Postgres)

The full schema is implemented in [supabase/migrations/](../supabase/migrations/). See `cost-control-spec-original.md` for the complete SQL — adapted in this repo to reuse the existing `profiles` and `projects` tables instead of creating parallel `user_profiles` / sub-project structures.

Adaptations made for srmd-hub integration:

- `user_profiles` → reuse existing `public.profiles`
- `user_role` enum → already exists with the required roles
- `projects` → extended with new columns (`parent_project_id`, `built_up_sft`, `pm_user_id`, `setup_progress_pct`, `status`)
- `permission_policies` is a **new** finer-grained matrix that any module can opt into; the existing `role_permissions` table stays as the default 3-flag matrix.

---

## 7+ SCREENS, NOTIFICATIONS, BUILD PLAN

See `cost-control-roadmap.md` for the phased plan adapted to srmd-hub. Sections 7–15 of the original spec (screens, notifications, style rules, success criteria) apply unchanged — the only difference is module integration uses the hub's existing auth/permissions infrastructure.

---

## Key adaptations vs the original spec

| Original spec said | In srmd-hub we do |
|---|---|
| `npx create-next-app srassk-cost-control` | New routes under `srmd-hub/app/(app)/cost-control/` |
| New `user_profiles` table | Reuse `public.profiles` |
| New `discipline_approvers`, `approval_thresholds` | Add as new tables; profiles.id is the FK |
| 17-flag permission matrix per-resource | Add new `permission_policies` table; existing `role_permissions` stays for simple modules |
| Telegram + WhatsApp bot project-scoped | Same, but registered at the hub level so all modules share the bot |
| Excel import endpoint | New route `/cost-control/import`; uses SheetJS just like the existing pipeline |
| Project Setup Wizard | Reusable `components/ProjectSetupWizard/` — every future module reuses it |

---

— end of master spec —
