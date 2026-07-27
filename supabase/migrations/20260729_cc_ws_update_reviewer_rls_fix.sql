-- BLOCKER FIX: cc_ws_update / cc_wsi_write only let a non-owner advance a sheet
-- via fn_cc_user_heads_discipline(), which reads cc_discipline_approvers — a
-- table that is EMPTY and never written by the app. So real (non-admin)
-- Trustee/Head approvers were blocked at the DB layer from signing off /
-- returning / releasing, and the actions failed SILENTLY (0-row update, no
-- error) while still writing audit/budget events. Only admins could approve.
--
-- Fix: authorize non-owner writes by the ROLE/APPROVAL model — a Cost Control
-- "reviewer" (admin, or a role listed as an approver in approval_rules for
-- cc_working_sheet), resolved from the EFFECTIVE per-module role. Mirrors
-- checkIsCcReviewer() in the app. Precise stage/amount/project authorization
-- still lives in the server actions (can_approve + projectApproverAllows) +
-- record_approval_event. The empty-table fn_cc_user_heads_discipline clause is
-- kept (harmless) for any future per-discipline approvers. Also adds a
-- ROW_COUNT guard to cc_approve_release so a filtered UPDATE fails loudly
-- instead of writing a phantom cc_budget_events row.

create or replace function public.fn_cc_is_reviewer(p_user uuid)
 returns boolean
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select public.fn_cc_is_admin(p_user)
    or exists (
      select 1 from public.approval_rules ar
      where ar.module_slug = 'cost-control'
        and ar.doc_type = 'cc_working_sheet'
        and ar.is_active = true
        and (
          ar.approver_role = public.effective_user_role(p_user, 'cost-control')::text
          or ar.override_role = public.effective_user_role(p_user, 'cost-control')::text
        )
    );
$$;

alter policy cc_ws_update on public.cc_working_sheets
using (
  public.fn_cc_is_admin(auth.uid())
  or ((engineer_id = auth.uid()) and (status = 'draft'::cc_ws_status))
  or public.fn_cc_user_heads_discipline(auth.uid(), discipline_id)
  or public.fn_cc_is_reviewer(auth.uid())
);

alter policy cc_wsi_write on public.cc_working_sheet_items
using (
  exists (
    select 1 from public.cc_working_sheets ws
    where ws.id = cc_working_sheet_items.working_sheet_id
      and (
        public.fn_cc_is_admin(auth.uid())
        or (ws.engineer_id = auth.uid() and ws.status = 'draft'::cc_ws_status)
        or public.fn_cc_user_heads_discipline(auth.uid(), ws.discipline_id)
        or public.fn_cc_is_reviewer(auth.uid())
      )
  )
)
with check (
  exists (
    select 1 from public.cc_working_sheets ws
    where ws.id = cc_working_sheet_items.working_sheet_id
      and (
        public.fn_cc_is_admin(auth.uid())
        or (ws.engineer_id = auth.uid() and ws.status = 'draft'::cc_ws_status)
        or public.fn_cc_user_heads_discipline(auth.uid(), ws.discipline_id)
        or public.fn_cc_is_reviewer(auth.uid())
      )
  )
);

-- cc_approve_release: 20260725 chain-baseline body + a ROW_COUNT guard.
create or replace function public.cc_approve_release(p_ws_id uuid, p_tranche numeric default null::numeric)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
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
  v_anchor     uuid;
  v_rows       integer;
  v_now        timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws_id for update;
  if not found then
    raise exception 'Working Sheet not found';
  end if;
  if v_ws.status::text not in ('atm_approved','partially_approved') then
    raise exception 'Only sheets signed off by the Atm Head (or already partially released) can be released into ERP';
  end if;
  if v_ws.engineer_id = auth.uid() and not public.fn_cc_is_admin(auth.uid()) then
    raise exception 'You cannot approve a sheet you raised yourself';
  end if;

  v_total := round(coalesce(v_ws.total_amount, 0)::numeric, 2);

  select chain_anchor_id into v_anchor
  from public.cc_ws_with_versions where id = p_ws_id;

  if v_anchor is null then
    v_already := round(coalesce(v_ws.approved_for_erp_amt, 0)::numeric, 2);
  else
    select coalesce(max(v.approved_for_erp_amt), 0)
      into v_already
      from public.cc_ws_with_versions v
     where v.chain_anchor_id = v_anchor
       and coalesce(v.summary_notes, '') not like '[IB%'
       and v.status::text <> 'cancelled'
       and v.archived_at is null;
    v_already := round(coalesce(v_already, 0)::numeric, 2);
  end if;

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

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Release not applied — you are not authorized to release this sheet, or it changed underneath you.';
  end if;

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
end $function$;
