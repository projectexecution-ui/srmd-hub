-- Wave 1 hygiene (audit of 3 Sept 2026). Every statement is idempotent: the
-- GitHub Action re-applies new migration files on merge, and this was also
-- applied to the live database by hand on 4 Sept 2026.

-- ── 1. One-off backup tables were reachable through the API with no RLS ──────
-- They are snapshots taken in August 2026 before two risky writes. Nothing in
-- the app reads them. Enabling RLS with no policy leaves them readable by the
-- service role (and the SQL editor) only.
alter table if exists public.budget_hub_state_backup_20260815         enable row level security;
alter table if exists public.budget_hub_state_history_backup_20260815 enable row level security;
alter table if exists public.procurement_tracker_state_backup_20260811 enable row level security;

-- ── 2. Two views ran with the definer's rights, bypassing RLS ─────────────────
-- Both are read-only decorations over tables that already carry policies
-- (cc_working_sheets → fn_cc_user_in_project; approval_events → module view
-- permission), so running them as the caller changes nothing for anyone the
-- policies already admit — it only closes the door for everyone else.
alter view public.cc_ws_with_versions set (security_invoker = on);
alter view public.approval_rule_stats set (security_invoker = on);

-- ── 3. Functions with a mutable search_path ───────────────────────────────────
-- Pins the schema so a same-named object in another schema can never be
-- substituted. Only the hub's own functions — pgvector's are the extension's.
alter function public.allowed_emails_lowercase() set search_path = public;
alter function public.approval_rules_touch() set search_path = public;
alter function public.approval_stages_touch() set search_path = public;
alter function public.blueprint_demo_log_status_change() set search_path = public;
alter function public.blueprint_demo_touch() set search_path = public;
alter function public.can_approve(text,text,text,text,numeric) set search_path = public;
alter function public.cc_bl_gate_estimate() set search_path = public;
alter function public.cc_ws_gate_deadline() set search_path = public;
alter function public.enforce_approval_via_matrix() set search_path = public;
alter function public.est_touch_updated_at() set search_path = public;
alter function public.fn_cc_ie_follow_erp() set search_path = public;
alter function public.fn_cc_ws_approval_url(uuid,uuid,uuid,uuid) set search_path = public;
alter function public.fn_inr_short(numeric) set search_path = public;
alter function public.fn_wh_loc_depth() set search_path = public;
alter function public.inv_fmt_qty(numeric) set search_path = public;
alter function public.inv_rpc_backoffice_approve(uuid,jsonb,text) set search_path = public;
alter function public.inv_rpc_backoffice_reject(uuid,text) set search_path = public;
alter function public.inv_rpc_cancel_request(uuid,text) set search_path = public;
alter function public.inv_rpc_create_request(uuid,uuid,text,text,date,jsonb) set search_path = public;
alter function public.inv_rpc_engineer_acknowledge(uuid,text) set search_path = public;
alter function public.inv_rpc_hop_approve(uuid,text) set search_path = public;
alter function public.inv_rpc_hop_approve(uuid,text,jsonb) set search_path = public;
alter function public.inv_rpc_hop_emergency_authorize(uuid,text) set search_path = public;
alter function public.inv_rpc_hop_reject(uuid,text) set search_path = public;
alter function public.inv_rpc_propose_item(text,text,text) set search_path = public;
alter function public.inv_rpc_return_material(uuid,numeric,inv_return_condition,text) set search_path = public;
alter function public.inv_rpc_review_item(uuid,boolean) set search_path = public;
alter function public.inv_rpc_set_reorder(uuid,uuid,numeric) set search_path = public;
alter function public.inv_rpc_stock_adjust(uuid,uuid,numeric,text) set search_path = public;
alter function public.inv_rpc_stock_damage(uuid,uuid,numeric,text) set search_path = public;
alter function public.inv_rpc_stock_receipt(uuid,uuid,numeric,text) set search_path = public;
alter function public.inv_rpc_stock_receipt_bulk(uuid,jsonb,text) set search_path = public;
alter function public.inv_rpc_stock_transfer(uuid,uuid,uuid,numeric,text) set search_path = public;
alter function public.inv_rpc_store_issue(uuid,jsonb,text) set search_path = public;
alter function public.inv_set_request_no() set search_path = public;
alter function public.inv_set_return_no() set search_path = public;
alter function public.module_labels_touch() set search_path = public;
alter function public.module_visibility_touch() set search_path = public;
alter function public.procurement_chase_notes_touch() set search_path = public;
alter function public.procurement_dropped_lines_touch() set search_path = public;
alter function public.procurement_user_project_visibility_touch() set search_path = public;
alter function public.project_floors_touch() set search_path = public;
alter function public.set_module_label(text,text,text) set search_path = public;
alter function public.set_role_permissions_audit() set search_path = public;

-- ── 4. A module slug that no longer exists ────────────────────────────────────
-- in4-indent-to-po was folded into procurement-tracker in May; its rows were
-- still being read by every permission and visibility lookup.
delete from public.module_visibility where slug = 'in4-indent-to-po';
delete from public.role_permissions  where module_slug = 'in4-indent-to-po';

-- ── 5. Daily Bills Report snapshots get their own table ───────────────────────
-- The cron kept one app_settings row PER DAY (bills_pipeline_report_2026-08-16,
-- _17, …). app_settings is the key space every page reads for its switches;
-- a report archive does not belong in it. The "latest" pointer
-- (bills_pipeline_report) stays where it is.
create table if not exists public.bills_pipeline_reports (
  report_date  date primary key,
  payload      text not null,
  generated_at timestamptz not null default now()
);
comment on table public.bills_pipeline_reports is
  'One JSON snapshot of the Daily Bills Report per IST day, written by /api/cron/bills-pipeline. Replaces the per-day app_settings keys.';

alter table public.bills_pipeline_reports enable row level security;

-- Same audience as the app_settings row it replaces: anyone signed in may read;
-- only the cron (service role) writes.
drop policy if exists "bills_pipeline_reports_read" on public.bills_pipeline_reports;
create policy "bills_pipeline_reports_read"
  on public.bills_pipeline_reports for select to authenticated using (true);

-- Carry the history across. The old keys are left in place for now so the live
-- site keeps its calendar until this code is deployed; a follow-up migration
-- deletes them once the new reader is on main.
insert into public.bills_pipeline_reports (report_date, payload)
select substring(key from 23)::date, value
from public.app_settings
where key ~ '^bills_pipeline_report_\d{4}-\d{2}-\d{2}$'
on conflict (report_date) do nothing;
