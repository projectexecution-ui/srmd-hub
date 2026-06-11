-- ============================================================
-- Cost Control review hardening (2026-06-11 full-module review).
-- Eight independent fixes, safe to re-run (idempotent):
--   1. entry_mode CHECK allows 'thumbrule' (repo/live drift fix)
--   2. cc_excel_rows RLS scoped to project membership (was module-wide)
--   3. cc-sheets storage RLS scoped to project membership
--   4. approval_events: direct INSERT removed (RPC-only writes)
--   5. approval-attachments read tightened (owner/admin/real members)
--   6. enforce_approval_via_matrix passes the release amount so
--      amount_cap_max rules bind on direct status updates too
--   7. my_approval_inbox shows ws_code instead of #hash
--   8. cc_approve_release(): atomic release approval (row lock —
--      fixes the concurrent-approver lost-update race) +
--      app_settings INSERT policy for admins (backup marker)
-- ============================================================

-- ── 0. Helper functions (self-containment) ───────────────────
-- These existed on live only (created out-of-band); defining them here
-- makes the migration chain rebuildable. Definitions match live exactly.
create or replace function public.fn_cc_is_admin(p_user uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  -- Admin = hub's profiles.role = 'admin'
  select coalesce(
    (select role::text = 'admin' from profiles where id = p_user),
    false
  );
$$;

create or replace function public.fn_cc_user_in_project(p_user uuid, p_project uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from project_assignments
    where user_id = p_user and project_id = p_project
  ) or fn_cc_is_admin(p_user);
$$;

-- ── 1. entry_mode CHECK: include 'thumbrule' ─────────────────
-- Live DB was patched out-of-band when thumbrule mode shipped; the
-- migration chain still had the two-value constraint, breaking any
-- environment rebuilt from migrations.
alter table public.cc_working_sheets drop constraint if exists cc_ws_entry_mode_chk;
alter table public.cc_working_sheets
  add constraint cc_ws_entry_mode_chk
  check (entry_mode in ('line_items','excel_summary','thumbrule'));

-- ── 2. cc_excel_rows: project-scoped RLS ─────────────────────
-- Was: any cost-control viewer could read EVERY project's parsed BOQ
-- rows (rates are commercially sensitive). Now: module permission AND
-- (admin OR member of the sheet's project), mirroring cc_wsi_*.
-- Note: the /check route's historical-rate comparison now only sees
-- rows from projects the caller belongs to — acceptable trade-off.
drop policy if exists "cc_excel_rows_read" on public.cc_excel_rows;
create policy "cc_excel_rows_read"
  on public.cc_excel_rows for select to authenticated using (
    exists (select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_view = true)
    and (
      public.fn_cc_is_admin(auth.uid())
      or exists (select 1 from public.cc_working_sheets ws
           where ws.id = cc_excel_rows.working_sheet_id
             and public.fn_cc_user_in_project(auth.uid(), ws.project_id))
    )
  );

drop policy if exists "cc_excel_rows_write" on public.cc_excel_rows;
create policy "cc_excel_rows_write"
  on public.cc_excel_rows for all to authenticated using (
    exists (select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_edit = true)
    and (
      public.fn_cc_is_admin(auth.uid())
      or exists (select 1 from public.cc_working_sheets ws
           where ws.id = cc_excel_rows.working_sheet_id
             and public.fn_cc_user_in_project(auth.uid(), ws.project_id))
    )
  ) with check (
    exists (select 1 from public.role_permissions rp, public.profiles p
      where p.id = auth.uid() and rp.role = p.role
        and rp.module_slug = 'cost-control' and rp.can_edit = true)
    and (
      public.fn_cc_is_admin(auth.uid())
      or exists (select 1 from public.cc_working_sheets ws
           where ws.id = cc_excel_rows.working_sheet_id
             and public.fn_cc_user_in_project(auth.uid(), ws.project_id))
    )
  );

-- ── 3. cc-sheets storage: project-scoped ─────────────────────
-- Upload paths are `${projectId}/timestamp-name.xlsx` (NewWSQuickForm),
-- so the first folder segment is the project id.
drop policy if exists "cc_sheets_read" on storage.objects;
create policy "cc_sheets_read"
  on storage.objects for select to authenticated using (
    bucket_id = 'cc-sheets' and (
      public.fn_cc_is_admin(auth.uid())
      or (
        exists (select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'cost-control' and rp.can_view = true)
        and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.fn_cc_user_in_project(auth.uid(), ((storage.foldername(name))[1])::uuid)
      )
    )
  );

drop policy if exists "cc_sheets_write" on storage.objects;
create policy "cc_sheets_write"
  on storage.objects for all to authenticated using (
    bucket_id = 'cc-sheets' and (
      public.fn_cc_is_admin(auth.uid())
      or (
        exists (select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'cost-control' and rp.can_edit = true)
        and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.fn_cc_user_in_project(auth.uid(), ((storage.foldername(name))[1])::uuid)
      )
    )
  ) with check (
    bucket_id = 'cc-sheets' and (
      public.fn_cc_is_admin(auth.uid())
      or (
        exists (select 1 from public.role_permissions rp, public.profiles p
          where p.id = auth.uid() and rp.role = p.role
            and rp.module_slug = 'cost-control' and rp.can_edit = true)
        and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.fn_cc_user_in_project(auth.uid(), ((storage.foldername(name))[1])::uuid)
      )
    )
  );

-- ── 4. approval_events: writes only via record_approval_event ─
-- The RPC is SECURITY DEFINER (owner bypasses RLS) and runs can_approve
-- internally. The direct INSERT policy let any authenticated user
-- fabricate audit rows attributed to themselves. Drop it.
drop policy if exists approval_events_insert on public.approval_events;

-- ── 5. approval-attachments: no read for zero-permission users ─
-- Was: any authenticated user. Now: the uploader, admins/portal owner,
-- or any user whose role has at least one module view permission (i.e.
-- a real allowlisted member). Timeline links use stored signed URLs and
-- keep working regardless.
drop policy if exists "approval_attachments_read" on storage.objects;
create policy "approval_attachments_read"
  on storage.objects for select to authenticated using (
    bucket_id = 'approval-attachments' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.profiles p
           where p.id = auth.uid()
             and (p.role::text = 'admin' or p.is_portal_owner = true))
      or exists (select 1 from public.role_permissions rp, public.profiles p
           where p.id = auth.uid() and rp.role = p.role and rp.can_view = true)
    )
  );

-- ── 6. matrix trigger: enforce amount caps on direct updates ──
-- can_approve() ignores amount_cap_max when p_amount is null, and the
-- trigger never passed an amount — so a capped head could bypass their
-- ₹2L-per-release cap with a direct status UPDATE. The trigger now
-- accepts an optional 4th argument naming a numeric column; it passes
-- the |new - old| delta of that column as the amount. Existing 3-arg
-- triggers (indents, JMR, inventory) behave exactly as before.
create or replace function public.enforce_approval_via_matrix()
returns trigger
language plpgsql
security definer
as $$
declare
  v_module      text := tg_argv[0];
  v_doc_type    text := tg_argv[1];
  v_status_col  text := tg_argv[2];
  v_amount_col  text;
  v_amount      numeric;
  v_from        text;
  v_to          text;
  v_has_rule    boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_from := (to_jsonb(old) ->> v_status_col);
  v_to   := (to_jsonb(new) ->> v_status_col);

  if v_from is null or v_to is null or v_from = v_to then
    return new;
  end if;

  select exists (
    select 1 from public.approval_rules ar
    where ar.is_active
      and ar.module_slug = v_module
      and ar.doc_type    = v_doc_type
      and ar.from_stage  = v_from
      and ar.to_stage    = v_to
  ) into v_has_rule;

  if not v_has_rule then
    return new;  -- Soft mode: not configured → no change in behaviour.
  end if;

  -- Optional amount column (4th trigger arg): pass the delta so
  -- amount_cap_max rules bind. 0-delta passes null (cap not applied —
  -- a pure status flip moves no money).
  if tg_nargs >= 4 then
    v_amount_col := tg_argv[3];
    v_amount := nullif(abs(
      coalesce(((to_jsonb(new) ->> v_amount_col))::numeric, 0)
      - coalesce(((to_jsonb(old) ->> v_amount_col))::numeric, 0)
    ), 0);
  end if;

  if public.can_approve(v_module, v_doc_type, v_from, v_to, v_amount) then
    return new;
  end if;

  raise exception
    'Not authorised: you cannot move % from % to % (configured by an admin in Approvals)',
    v_doc_type, v_from, v_to;
end $$;

drop trigger if exists trg_cc_working_sheets_matrix on public.cc_working_sheets;
create trigger trg_cc_working_sheets_matrix
  before update of status on public.cc_working_sheets
  for each row
  execute function public.enforce_approval_via_matrix('cost-control', 'cc_working_sheet', 'status', 'approved_for_erp_amt');

-- ── 7. my_approval_inbox: human WS codes ─────────────────────
-- Cost Control rows showed '#3fa2bc91'; now they show the smart code
-- (P2A02-1102-Q01) like every other module shows its document number.
create or replace function public.my_approval_inbox()
returns table (
  module_slug   text,
  doc_type      text,
  doc_table     text,
  doc_id        uuid,
  doc_no        text,
  doc_url       text,
  from_stage    text,
  next_stage    text,
  project_id    uuid,
  project_code  text,
  project_name  text,
  doc_date      date,
  created_at    timestamptz,
  amount        numeric,
  urgency       text
)
language sql stable security definer
set search_path = public
as $$
  with me as (
    select role::text as default_role from public.profiles where id = auth.uid()
  ),
  my_rules as (
    select ar.module_slug, ar.doc_type, ar.from_stage, ar.to_stage
    from public.approval_rules ar
    where ar.is_active
      and (
        (select default_role from me) = 'admin'
        or public.effective_user_role(auth.uid(), ar.module_slug)::text
             in (ar.approver_role, coalesce(ar.override_role, ''))
      )
  )

  -- Inventory requests
  select
    'inventory'::text, 'inv_request'::text, 'inv_requests'::text,
    r.id,
    coalesce(r.request_no, '#' || substring(r.id::text, 1, 8)),
    '/inventory/requests/' || r.id::text,
    r.status::text,
    (select to_stage from my_rules m
      where m.module_slug='inventory' and m.doc_type='inv_request' and m.from_stage = r.status::text
      limit 1),
    r.project_id, p.code, p.name,
    r.required_by_date,
    r.created_at,
    null::numeric,
    r.urgency::text
  from public.inv_requests r
  left join public.projects p on p.id = r.project_id
  where exists (
    select 1 from my_rules m
    where m.module_slug='inventory' and m.doc_type='inv_request' and m.from_stage = r.status::text
  )

  union all

  -- Indents
  select
    'indents','indent','indents',
    i.id, coalesce(i.indent_no, '#' || substring(i.id::text, 1, 8)),
    '/indents/' || i.id::text, i.stage::text,
    (select to_stage from my_rules m where m.module_slug='indents' and m.doc_type='indent' and m.from_stage = i.stage::text limit 1),
    i.project_id, p.code, p.name, i.indent_date, i.created_at, null::numeric, null::text
  from public.indents i
  left join public.projects p on p.id = i.project_id
  where exists (select 1 from my_rules m where m.module_slug='indents' and m.doc_type='indent' and m.from_stage = i.stage::text)

  union all

  -- JMR bills
  select
    'jmr-bills','jmr_bill','jmr_bills',
    b.id, coalesce(b.bill_number, '#' || substring(b.id::text, 1, 8)),
    '/jmr/bills/' || b.id::text, b.status::text,
    (select to_stage from my_rules m where m.module_slug='jmr-bills' and m.doc_type='jmr_bill' and m.from_stage = b.status::text limit 1),
    b.project_id, p.code, p.name, b.bill_date, b.created_at, b.total_amount, null::text
  from public.jmr_bills b
  left join public.projects p on p.id = b.project_id
  where exists (select 1 from my_rules m where m.module_slug='jmr-bills' and m.doc_type='jmr_bill' and m.from_stage = b.status::text)

  union all

  -- JMR daily entries
  select
    'jmr','jmr_entry','jmr_daily_entries',
    e.id, '#' || substring(e.id::text, 1, 8),
    '/jmr/entries/' || e.id::text, e.status::text,
    (select to_stage from my_rules m where m.module_slug='jmr' and m.doc_type='jmr_entry' and m.from_stage = e.status::text limit 1),
    e.project_id, p.code, p.name, e.entry_date, e.created_at, e.amount, null::text
  from public.jmr_daily_entries e
  left join public.projects p on p.id = e.project_id
  where exists (select 1 from my_rules m where m.module_slug='jmr' and m.doc_type='jmr_entry' and m.from_stage = e.status::text)

  union all

  -- Cost control working sheets
  select
    'cost-control','cc_working_sheet','cc_working_sheets',
    ws.id, coalesce(ws.ws_code, '#' || substring(ws.id::text, 1, 8)),
    '/cost-control/working-sheets/' || ws.id::text, ws.status::text,
    (select to_stage from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text limit 1),
    ws.project_id, p.code, p.name,
    coalesce(ws.submitted_at::date, ws.created_at::date),
    ws.created_at,
    coalesce(ws.total_amount, ws.summary_total),
    null::text
  from public.cc_working_sheets ws
  left join public.projects p on p.id = ws.project_id
  where exists (select 1 from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text)

  -- 12 = doc_date, 13 = created_at (the original ordered by 11 =
  -- project_name — an off-by-one that sorted the inbox alphabetically
  -- by project instead of newest-first).
  order by 12 desc nulls last, 13 desc
$$;

-- ── 8a. cc_approve_release(): atomic release approval ─────────
-- Replaces the read-compute-write sequence in the approveWorkingSheet
-- server action. SELECT ... FOR UPDATE serialises concurrent approvers
-- (no more lost releases / double full-approvals); rounding to 2dp and
-- the snap-to-total on the final release fix paisa-dust edge cases.
-- SECURITY INVOKER on purpose: RLS and the matrix trigger run as the
-- calling user, exactly like the old client-side update did.
create or replace function public.cc_approve_release(
  p_ws_id   uuid,
  p_tranche numeric default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ws         public.cc_working_sheets%rowtype;
  v_total      numeric;
  v_already    numeric;
  v_remaining  numeric;
  v_tranche    numeric;
  v_cumulative numeric;
  v_full       boolean;
  v_from       text;
  v_to         text;
  v_bl_id      uuid;
  v_now        timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws_id for update;
  if not found then
    raise exception 'Working Sheet not found';
  end if;
  if v_ws.status::text not in ('submitted','partially_approved') then
    raise exception 'Only submitted or partially-approved sheets can be approved further';
  end if;
  if v_ws.engineer_id = auth.uid() and not public.fn_cc_is_admin(auth.uid()) then
    raise exception 'You cannot approve a sheet you raised yourself';
  end if;

  v_total     := round(coalesce(v_ws.total_amount, 0)::numeric, 2);
  v_already   := round(coalesce(v_ws.approved_for_erp_amt, 0)::numeric, 2);
  v_remaining := v_total - v_already;
  v_tranche   := round(coalesce(p_tranche, v_remaining)::numeric, 2);

  if v_tranche <= 0 then
    raise exception 'Release amount must be greater than zero';
  end if;
  if v_tranche > v_remaining + 0.5 then
    raise exception 'Release amount (%) exceeds the remaining amount (%)', v_tranche, v_remaining;
  end if;
  if v_tranche > v_remaining then
    v_tranche := v_remaining;
  end if;

  v_cumulative := round(v_already + v_tranche, 2);
  v_full       := v_cumulative >= v_total - 0.5;
  if v_full then
    -- Snap to the exact total so nothing is left "unreleasable" and the
    -- ledger (sum of release events) ties to the sheet total.
    v_tranche    := round(v_total - v_already, 2);
    v_cumulative := v_total;
  end if;

  v_from := v_ws.status::text;
  v_to   := case when v_full then 'approved' else 'partially_approved' end;

  if not public.can_approve('cost-control', 'cc_working_sheet', v_from, v_to, v_tranche) then
    raise exception 'Your role cannot approve a release of this amount. Check /admin/approvals.';
  end if;

  update public.cc_working_sheets set
    status               = v_to::cc_ws_status,
    approved_for_erp_amt = v_cumulative,
    approved_for_erp_at  = v_now,
    approved_for_erp_by  = auth.uid(),
    approved_at          = case when v_full then v_now else approved_at end,
    approved_by          = case when v_full then auth.uid() else approved_by end
  where id = p_ws_id;

  select id into v_bl_id from public.cc_budget_lines
  where project_id = v_ws.project_id
    and discipline_id = v_ws.discipline_id
    and sub_skill_id = v_ws.sub_skill_id
    and line_type = v_ws.line_type
  limit 1;

  insert into public.cc_budget_events(
    budget_line_id, project_id, event_type, delta_amount, related_ws_id,
    remarks, requested_by, approved_by, approval_status
  ) values (
    v_bl_id, v_ws.project_id, 'ws_approved', v_tranche, p_ws_id,
    case when v_full
      then 'WS fully approved — final release Rs ' || v_tranche || ' (awaiting IN4 entry)'
      else 'WS release approved Rs ' || v_tranche || ' (cumulative Rs ' || v_cumulative || ' of Rs ' || v_total || ' · awaiting IN4 entry)'
    end,
    auth.uid(), auth.uid(), 'approved'
  );

  return jsonb_build_object(
    'ok', true,
    'new_status', v_to,
    'approved_so_far', v_cumulative,
    'released', v_tranche
  );
end $$;

grant execute on function public.cc_approve_release(uuid, numeric) to authenticated;

-- ── 8c. BPH links: remember what the last pull wrote ─────────
-- Lets the weekly resync detect sub-skill lines that vanished from the
-- BPH report (descoped/zeroed in IN4) and zero them out instead of
-- letting stale figures persist forever.
alter table public.cc_bph_project_links add column if not exists last_pull jsonb;

-- ── 8b. app_settings: admins can INSERT ──────────────────────
-- Only SELECT + UPDATE policies existed, so upserting a NEW key (e.g.
-- the cc_last_backup marker) always failed. Admins can now insert.
drop policy if exists "admin can insert app_settings" on public.app_settings;
create policy "admin can insert app_settings"
  on public.app_settings for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role::text = 'admin' or p.is_portal_owner = true)
  ));

-- The legacy UPDATE policy covers role='admin' only; the upsert's ON
-- CONFLICT UPDATE arm must also work for portal owners (same set the
-- INSERT policy grants), or the backup marker write fails for them.
drop policy if exists "portal owner can update app_settings" on public.app_settings;
create policy "portal owner can update app_settings"
  on public.app_settings for update to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_portal_owner = true
  ));

-- ── 8d. cc-backups storage policies ──────────────────────────
-- The bucket existed with NO policies, so the admin-session POST upload
-- was rejected by storage RLS — the auto-backup could never store a
-- file. Admins (profiles.role) get full access; nobody else needs it
-- (the cron path uses the service role, which bypasses RLS).
insert into storage.buckets (id, name, public)
values ('cc-backups', 'cc-backups', false)
on conflict (id) do nothing;

drop policy if exists "cc_backups_admin_all" on storage.objects;
create policy "cc_backups_admin_all"
  on storage.objects for all to authenticated
  using (bucket_id = 'cc-backups' and public.fn_cc_is_admin(auth.uid()))
  with check (bucket_id = 'cc-backups' and public.fn_cc_is_admin(auth.uid()));
