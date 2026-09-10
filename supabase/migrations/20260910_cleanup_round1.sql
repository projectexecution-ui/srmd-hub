-- Clean-up round 1 — what the revamped CT Hub no longer needs (Aksha, 10 Sep 2026).
-- See docs/audit/12-CLEANUP-LIST.md for the decisions, item by item.
--
-- Order matters: 1) copy everything into a backup schema, 2) rewrite the two
-- functions that read tables about to go, 3) drop functions/views/tables,
-- 4) delete the configuration rows that pointed at them, 5) storage (dashboard, see below),
-- 6) trim the sync snapshot tables, 7) the three August backup tables.
-- Idempotent throughout (IF EXISTS / IF NOT EXISTS), so a re-run is harmless.

-- ── 1. Backup copies (full fidelity, inside the database) ────────────────────
create schema if not exists cleanup_backup_20260910;
do $$
declare t text;
begin
  foreach t in array array[
    'vendors','est_categories','est_disciplines','est_rates','est_subcategories','est_upload_log','est_wo_history',
    'inv_items','inv_stock','inv_stock_movements','inv_requests','inv_request_items','inv_request_status_log',
    'inv_stock_checks','inv_stock_check_items','inv_returns','inv_warehouses','inv_engineer_projects','inv_project_setup',
    'inv_gate_passes','inv_notifications',
    'wh_items','wh_stock','wh_movements','wh_lists','wh_locations','wh_requests','wh_request_lines','wh_number_series',
    'wh_setting_changes','wh_po','wh_po_lines','wh_counts','wh_count_lines','wh_gate_in','wh_gate_in_lines','wh_gate_out','wh_gate_out_lines',
    'jmr_daily_entries','jmr_contractors','jmr_items','jmr_rate_cards','jmr_user_project_access','jmr_activity_log','jmr_rate_change_log',
    'sched_items','sched_progress','sched_promises','sched_date_changes','sched_drawings','sched_drawing_revisions',
    'blueprint_demo_requests','blueprint_demo_request_status_log','dsr_reports','dsr_tracking','dsr_attachments',
    'cmp_comparisons','cmp_items','cmp_quotes','cmp_vendors',
    'indents','indent_lines','indent_status_snapshots','purchase_orders','po_lines','grns','grn_lines','invoices','invoice_lines','payments','uploads'
  ] loop
    if to_regclass('public.' || t) is not null and to_regclass('cleanup_backup_20260910.' || t) is null then
      execute format('create table cleanup_backup_20260910.%I as table public.%I', t, t);
    end if;
  end loop;
end $$;

create table if not exists cleanup_backup_20260910.role_permissions_removed as
  select * from public.role_permissions where module_slug in (
    'blueprint-demo','comparison','daily-site-report','established-rates','grns','indents','inventory','invoices','payments','pos',
    'projects','uploads','vendors','warehouse','jmr','jmr-admin','schedule','budget-vs-actual');
create table if not exists cleanup_backup_20260910.approval_rules_removed as
  select * from public.approval_rules where module_slug in ('blueprint-demo','indents','inventory','warehouse','jmr');
create table if not exists cleanup_backup_20260910.app_settings_removed as
  select * from public.app_settings where key in ('inv_approval_mode','sidebar_groups')
     or key like 'wh\_%' escape '\' or key like 'jmr\_%' escape '\' or key like 'sched\_%' escape '\';
create table if not exists cleanup_backup_20260910.module_visibility_removed as
  select * from public.module_visibility where slug in (
    'blueprint-demo','comparison','daily-site-report','established-rates','grns','indents','inventory','invoices','payments','pos',
    'projects','uploads','vendors','warehouse','jmr','schedule','budget-vs-actual');
create table if not exists cleanup_backup_20260910.module_labels_removed as
  select * from public.module_labels where slug in ('inventory','jmr','budget-vs-actual','cost-control');
create table if not exists cleanup_backup_20260910.notification_rules_removed as
  select * from public.notification_rules where event_type in (
    'daily_site_report_digest','inv_site_stock_reminder','jmr_entry_submitted','jmr_entry_approved','jmr_entry_flagged','sched_promise_nudge',
    'wh_request_raised','wh_request_decided','wh_request_to_issue','wh_request_issued','wh_return_waived');
create table if not exists cleanup_backup_20260910.user_module_roles_removed as
  select * from public.user_module_roles where module_slug = 'jmr-admin';

-- ── 2. Functions that read the tables about to go ────────────────────────────
-- my_approval_inbox: only Cost Control working sheets remain in the inbox.
create or replace function public.my_approval_inbox()
 returns table(module_slug text, doc_type text, doc_table text, doc_id uuid, doc_no text, doc_url text, from_stage text, next_stage text, project_id uuid, project_code text, project_name text, doc_date date, created_at timestamp with time zone, amount numeric, urgency text, work_label text, raised_by text)
 language sql stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select role::text as default_role from public.profiles where id = auth.uid()
  ),
  my_rules as (
    select ar.module_slug, ar.doc_type, ar.from_stage, ar.to_stage
    from public.approval_rules ar
    where ar.is_active
      and not ar.is_blocking
      and (
        (select default_role from me) = 'admin'
        or public.effective_user_role(auth.uid(), ar.module_slug)::text
             in (ar.approver_role, coalesce(ar.override_role, ''))
      )
  ),
  disabled as (
    select slug from public.module_visibility where not enabled
  ),
  inbox (module_slug, doc_type, doc_table, doc_id, doc_no, doc_url, from_stage, next_stage,
         project_id, project_code, project_name, doc_date, created_at, amount, urgency,
         work_label, raised_by) as (
    select
      'cost-control','cc_working_sheet','cc_working_sheets',
      ws.id, coalesce(ws.ws_code, '#' || substring(ws.id::text, 1, 8)),
      public.fn_cc_ws_approval_url(ws.project_id, ws.discipline_id, ws.sub_skill_id, ws.id),
      ws.status::text,
      (select to_stage from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text limit 1),
      ws.project_id, p.code, p.name,
      coalesce(ws.submitted_at::date, ws.created_at::date), ws.created_at,
      coalesce(ws.total_amount, ws.summary_total), null::text,
      coalesce(ss.name, dis.name), coalesce(eng.full_name, eng.name)
    from public.cc_working_sheets ws
    left join public.projects p on p.id = ws.project_id
    left join public.cc_sub_skills ss on ss.id = ws.sub_skill_id
    left join public.cc_disciplines dis on dis.id = ws.discipline_id
    left join public.profiles eng on eng.id = ws.engineer_id
    where ws.status::text <> 'draft'
      and ws.archived_at is null
      and exists (select 1 from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text)
      and (
        (select default_role from me) = 'admin'
        or exists (
          select 1 from public.cc_project_approvers cpa
          where cpa.project_id = ws.project_id
            and cpa.user_id = auth.uid()
            and cpa.role = case ws.status::text
                 when 'submitted'          then 'project_head'
                 when 'ph_approved'        then 'head'
                 when 'atm_approved'       then 'founder'
                 when 'partially_approved' then 'founder'
                 else null end
        )
        or exists (
          select 1 from public.cc_discipline_approvers da
          where da.discipline_id = ws.discipline_id
            and da.approver_user_id = auth.uid()
            and da.is_active
        )
        or not exists (
          select 1 from public.cc_project_approvers cpa2
          where cpa2.project_id = ws.project_id
            and cpa2.role = case ws.status::text
                 when 'submitted'          then 'project_head'
                 when 'ph_approved'        then 'head'
                 when 'atm_approved'       then 'founder'
                 when 'partially_approved' then 'founder'
                 else null end
        )
      )
  )
  select inbox.module_slug, inbox.doc_type, inbox.doc_table, inbox.doc_id, inbox.doc_no, inbox.doc_url,
         inbox.from_stage, inbox.next_stage, inbox.project_id, inbox.project_code, inbox.project_name,
         inbox.doc_date, inbox.created_at, inbox.amount, inbox.urgency, inbox.work_label, inbox.raised_by
  from inbox
  where inbox.module_slug not in (select slug from disabled)
  order by inbox.doc_date desc nulls last, inbox.created_at desc
$function$;

-- recycle_restore: the two restorable sources (Established Rates, old Inventory) are gone.
create or replace function public.recycle_restore(p_bin_id uuid)
 returns jsonb
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v_is_admin boolean;
  v_row public.recycle_bin;
begin
  v_is_admin := (public.current_user_role() = 'admin')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_portal_owner);
  if not v_is_admin then raise exception 'Only an admin can restore items'; end if;

  select * into v_row from public.recycle_bin where id = p_bin_id for update;
  if not found then raise exception 'Recycle item not found'; end if;
  if v_row.restored_at is not null then return jsonb_build_object('ok', true, 'noop', true); end if;

  -- Established Rates and the old Inventory were removed on 10 Sep 2026; nothing in the bin can be restored in place.
  raise exception 'Restore not supported for % — the module was removed on 10 Sep 2026; see cleanup_backup_20260910', v_row.source_table;
end;
$function$;

-- ── 3. Drop the modules' own functions, views and tables ────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (
      p.proname like 'inv\_%' escape '\' or p.proname like 'fn\_wh\_%' escape '\' or p.proname like 'jmr\_%' escape '\'
      or p.proname in ('dsr_is_assigned','blueprint_demo_log_status_change','blueprint_demo_sla_inbox')
    )
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop view if exists public.inv_stock_available cascade;

drop table if exists
  public.wh_count_lines, public.wh_counts, public.wh_gate_in_lines, public.wh_gate_in, public.wh_gate_out_lines, public.wh_gate_out,
  public.wh_request_lines, public.wh_requests, public.wh_movements, public.wh_stock, public.wh_po_lines, public.wh_po,
  public.wh_items, public.wh_lists, public.wh_locations, public.wh_number_series, public.wh_setting_changes,
  public.jmr_activity_log, public.jmr_rate_change_log, public.jmr_daily_entries, public.jmr_rate_cards, public.jmr_items,
  public.jmr_contractors, public.jmr_user_project_access,
  public.sched_drawing_revisions, public.sched_drawings, public.sched_date_changes, public.sched_promises, public.sched_progress, public.sched_items,
  public.inv_stock_check_items, public.inv_stock_checks, public.inv_returns, public.inv_request_status_log, public.inv_request_items,
  public.inv_requests, public.inv_stock_movements, public.inv_stock, public.inv_items, public.inv_gate_passes, public.inv_notifications,
  public.inv_engineer_projects, public.inv_project_setup, public.inv_warehouses,
  public.est_wo_history, public.est_rates, public.est_subcategories, public.est_categories, public.est_disciplines, public.est_upload_log,
  public.blueprint_demo_request_status_log, public.blueprint_demo_requests,
  public.dsr_attachments, public.dsr_tracking, public.dsr_reports,
  public.cmp_quotes, public.cmp_items, public.cmp_vendors, public.cmp_comparisons,
  public.indent_status_snapshots, public.indent_lines, public.indents, public.po_lines, public.purchase_orders,
  public.grn_lines, public.grns, public.invoice_lines, public.invoices, public.payments, public.uploads,
  public.vendors
cascade;

-- ── 4. Configuration rows that pointed at them ──────────────────────────────
delete from public.approval_rules where module_slug in ('blueprint-demo','indents','inventory','warehouse','jmr');
delete from public.user_module_roles where module_slug = 'jmr-admin';
delete from public.role_permissions where module_slug in (
  'blueprint-demo','comparison','daily-site-report','established-rates','grns','indents','inventory','invoices','payments','pos',
  'projects','uploads','vendors','warehouse','jmr','jmr-admin','schedule','budget-vs-actual');
delete from public.module_visibility where slug in (
  'blueprint-demo','comparison','daily-site-report','established-rates','grns','indents','inventory','invoices','payments','pos',
  'projects','uploads','vendors','warehouse','jmr','schedule','budget-vs-actual');
delete from public.module_labels where slug in ('inventory','jmr','budget-vs-actual');
update public.module_labels set label = 'Projects', description = 'Projects, budgets and approvals — the workspace' where slug = 'cost-control';
delete from public.notification_rules where event_type in (
  'daily_site_report_digest','inv_site_stock_reminder','jmr_entry_submitted','jmr_entry_approved','jmr_entry_flagged','sched_promise_nudge',
  'wh_request_raised','wh_request_decided','wh_request_to_issue','wh_request_issued','wh_return_waived');
delete from public.notification_schedule where event_type in (
  'wh_request_raised','wh_request_decided','wh_request_to_issue','wh_request_issued','wh_return_waived','sched_promise_nudge',
  'jmr_entry_submitted','jmr_entry_approved','jmr_entry_flagged','daily_site_report_digest','inv_site_stock_reminder');
delete from public.app_settings where key in ('inv_approval_mode','sidebar_groups')
   or key like 'wh\_%' escape '\' or key like 'jmr\_%' escape '\' or key like 'sched\_%' escape '\';

-- ── 5. Storage buckets of the removed modules ───────────────────────────────
-- Postgres refuses direct deletes from storage tables (storage.protect_delete). The six
-- buckets — jmr-photos (7 files), site-reports (1), item-images, inv-gate-passes, wh-bills,
-- wh-gate-passes (empty) — are removed from the Supabase dashboard → Storage instead.

-- ── 6. Sync snapshot tables: keep the last 30 of each (the code prunes from now on) ──
delete from public.procurement_tracker_state_history
  where id not in (select id from public.procurement_tracker_state_history order by snapshot_at desc nulls last limit 30);
delete from public.budget_hub_state_history
  where id not in (select id from public.budget_hub_state_history order by snapshot_at desc nulls last limit 30);
delete from public.contractor_report_state_history
  where id not in (select id from public.contractor_report_state_history order by created_at desc nulls last limit 30);
delete from public.supplier_report_state_history
  where id not in (select id from public.supplier_report_state_history order by created_at desc nulls last limit 30);

-- ── 7. The three one-off August backup tables ───────────────────────────────
drop table if exists public.budget_hub_state_backup_20260815, public.budget_hub_state_history_backup_20260815, public.procurement_tracker_state_backup_20260811;
