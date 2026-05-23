# Cost Control — phased build plan (adapted for srmd-hub)

> Live progress tracker for Mayank's SRASSK Cost Control module. The full
> spec is in [cost-control-spec.md](./cost-control-spec.md). This file
> tracks what's done, what's next, and how it maps to the spec's 12-week
> session plan.

---

## Architectural principle (apply to every future module)

User/hierarchy/permissions/project-setup are **shared infrastructure**, not
per-module. See the AGENTS note + `lib/modules.ts` + `components/ProjectSetupWizard/`.

- New module = a tile in `lib/modules.ts` + RLS using `role_permissions`.
- Don't introduce module-local user lists, role enums, or auth.
- "Needs a project" module = reuse `public.projects` + `ProjectSetupWizard`.
- Finer-grained permissions needed? Add resource rows to `permission_policies`
  (Cost Control's table — any module can use it).

---

## Session 0 — Foundation (DONE — May 23 2026)

This session's deliverables:

- [x] [docs/cost-control-spec.md](./cost-control-spec.md) — the full spec, adapted for hub integration
- [x] [supabase/migrations/20260523_cost_control_foundation.sql](../supabase/migrations/20260523_cost_control_foundation.sql) — all cost-control tables (NOT yet applied to DB)
- [x] [supabase/migrations/20260523_cost_control_seed.sql](../supabase/migrations/20260523_cost_control_seed.sql) — placeholder disciplines + sub-skills + default permission_policies
- [x] Cost Control tile added to `lib/modules.ts` (`slug: 'cost-control'`)
- [x] `/cost-control` landing page — lists projects with setup-progress chips
- [x] `/cost-control/projects/[id]` detail stub with SetupProgressBanner
- [x] `/cost-control/projects/new` — Step 1 (basics) fully wired, Step 2 (disciplines) fully wired, Steps 3–4 render but write logic is stubbed
- [x] `components/ProjectSetupWizard/` — reusable shared component (any future module reuses it)

### To bring this session live, you (Mayank/Aksha) need to:

1. **Review the migration SQL files.** Confirm columns and naming.
2. **Apply migrations to Supabase** — via Supabase MCP, the SQL editor, or `supabase db push`. Foundation first, then seed.
3. **Replace seed data with the real CSVs** — `data/disciplines.csv`, `data/sub_skills.csv`, `data/users_initial.csv`, `data/vendors_initial.csv` (spec section 11). Until then, the seed has ~21 placeholder disciplines and ~28 placeholder sub-skills.
4. **Tune `/admin/permissions`** — Cost Control gets default view/edit per role; tighten as needed.

---

## Session 1 — finish the wizard + project detail (NEXT)

- [ ] Wire Step 3 (sub-skills): list sub-skills per picked discipline, default-tick all, "Save Discipline" buttons, bump `setup_progress_pct` to 80%. See `setProjectSubSkills` stub in `components/ProjectSetupWizard/actions.ts`.
- [ ] Wire Step 4 (engineer assignments): multi-select engineers × disciplines on this project. Write to `public.project_assignments` with `role='engineer'`. Mark `setup_progress_pct=100`, `cc_status='active'`.
- [ ] Fill out project detail page (`/cost-control/projects/[id]`): show enabled disciplines, sub-skills, assigned engineers; inline "+ Add Discipline" + "+ Add Sub-Skill" buttons (spec section 4).
- [ ] Implement `/cost-control/projects/[id]/setup` — resumable setup that drops you on whichever step is unfinished.

---

## Session 2 — Working Sheets (THE BIG ONE — spec section 5)

Maps to spec session 6.

- [ ] `/cost-control/working-sheets` list + filters by project / status / engineer
- [ ] `/cost-control/working-sheets/new?project=…&sub_skill=…` — Working Sheet editor
- [ ] Editable item table with row add/remove, real-time amount calc
- [ ] Auto-save draft on every keystroke (debounced 500ms)
- [ ] Status state machine + lock UI for non-draft
- [ ] Vendor + UOM dropdowns (UOM enum, vendor master)
- [ ] Past-spend context strip
- [ ] Attachments → Supabase Storage

---

## Session 3 — Duplicate detection (spec section 5.3-5.5)

- [ ] Layer 1 (lexical, client) — Jaccard on tokens
- [ ] Layer 2 (semantic, server) — OpenAI embed + pgvector cosine query
- [ ] Layer 3 (triplet) — Sub-Skill + UOM + Vendor + Location exact match
- [ ] Override dialog (structured category + min-30-char free text)
- [ ] Continuation linking

Requires: `OPENAI_API_KEY` in env. `vector(1536)` column already created on `cc_working_sheet_items`.

---

## Session 4 — Approvals + Budget Shift (spec session 7-8)

- [ ] `/cost-control/approvals` inbox
- [ ] Approval routing via `cc_discipline_approvers` + `cc_approval_thresholds`
- [ ] On approve: advance entity status, write `cc_budget_events` rows
- [ ] `/cost-control/shift` wizard — atomic source-/destination+ pair

---

## Session 5 — Permissions admin extensions (spec session 9)

The hub's `/admin/permissions` today is a 3-flag matrix per module. Cost
Control's spec wants a 17-flag matrix per resource (`cc_working_sheet`,
`cc_budget_event`, etc.). Two options:

- **Option A** — second matrix at `/admin/permissions/granular` that
  edits the `permission_policies` table directly. Keeps the existing
  simple matrix untouched.
- **Option B** — fold both into one screen with a "Granular mode" toggle.

Lean Option A first.

Also build: `/admin/cost-control/thresholds`, `/admin/cost-control/approvers`,
`/admin/cost-control/notifications` (the rules table).

---

## Session 6 — Excel import (spec session 5)

- [ ] `/cost-control/import` page — drag-drop xlsx
- [ ] SheetJS parser for ENGG_CONSOLIDATED_BUDGET_REPORT format
- [ ] Preview + auto-detected column mapping
- [ ] On commit: insert `cc_budget_lines` + a series of `cc_budget_events` (`event_type='budget_add'`)
- [ ] Raw parsed data → `cc_excel_imports.raw_data` for replay

---

## Session 7 — Telegram bot (spec session 10)

- [ ] Bot setup via Telegram Bot API
- [ ] Webhook at `/api/telegram/webhook`
- [ ] On approval creation → send formatted message to approver's `telegram_chat_id` (need a column on `profiles` for this) with inline Approve/Reject buttons
- [ ] Button taps → `/api/telegram/callback` → update approval + write audit

Requires: add `telegram_chat_id`, `whatsapp_phone` columns to `public.profiles`.

---

## Session 8 — WhatsApp Cloud API (spec session 11)

Phase 2. After Meta business verification.

---

## Session 9 — Audit, reports, export (spec session 12)

- [ ] `/cost-control/audit` — searchable log of `cc_budget_events`
- [ ] `/cost-control/reports/rs-per-sft` — heat map
- [ ] `/cost-control/reports/rate-history` — vendor rate trends
- [ ] Excel export that regenerates ENGG_CONSOLIDATED_BUDGET_REPORT from current DB state

---

## Decisions made & deviations from the original spec

| Spec said | We did | Reason |
|---|---|---|
| `npx create-next-app srassk-cost-control` | New routes inside srmd-hub | Aksha's "totally integrated" rule + shared-infra principle |
| New `user_profiles` table | Reuse `public.profiles` | Same |
| `user_role` enum with `pm`, `accounts` | Hub already has `admin/founder/head/uploader/engineer/site_staff/viewer`. Treating `uploader` as PM-equivalent for now | Don't fork the enum mid-stream; we can rename `uploader` → `pm` later via a migration |
| Tables named `disciplines`, `working_sheets` | Prefixed `cc_` | Avoid clashing with future modules. Other modules can drop the prefix when integrating their own pattern |
| New `vendors` table | Reuse existing `public.vendors` | Cost Control's vendor needs match what's already there |
| `discipline_approvers`, `approval_thresholds`, etc. | Prefixed `cc_` | Same reasoning |
| Granular `permission_policies` matrix replaces simple matrix | Both coexist | Existing modules stay simple; Cost Control opts into granular. Other modules can adopt later |

---

## Things deliberately NOT done this session (and why)

- **RLS policies** — the migration enables tables but no policies. The hub already enforces broad permissions via `requirePermission()` at page level; row-level needs to wait until we know the access patterns. Add in Session 2 alongside the Working Sheets writes.
- **Excel import** — Mayank to provide sample files first.
- **Bot integration** — depends on Mayank registering the bot.
- **Discipline approver + threshold UIs** — admin will manage via direct DB until Session 5.
- **Replacing seed CSVs with real data** — Mayank to provide.
- **Vendor extensions** (gstin, pan, category) — `public.vendors` may already have these; if not, add via a hub-level migration, not a cost-control-only one.
