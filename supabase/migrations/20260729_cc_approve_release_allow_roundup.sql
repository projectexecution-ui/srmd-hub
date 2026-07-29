-- Allow the Trustee to release MORE than the asked/remaining amount (e.g. round
-- 9,90,000 up to 10,00,000). Previously the RPC hard-rejected any tranche above
-- the remaining balance; now it's allowed and the extra is recorded. The UI
-- warns + asks for confirmation before sending an over-release. A normal full
-- release still snaps to the exact total (no paise drift); only a deliberate
-- round-up keeps the higher figure.
create or replace function public.cc_approve_release(p_ws_id uuid, p_tranche numeric DEFAULT NULL::numeric)
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
  v_over       numeric;
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

  -- The Trustee MAY release more than the asked/remaining amount (rounding up).
  -- No hard cap here — the UI warns + confirms first. The extra is recorded.
  v_cumulative := round(v_already + v_tranche, 2);
  v_full       := v_cumulative >= v_total - 0.5;
  -- Snap to the exact total on a NORMAL full release (avoid paise drift); keep
  -- the higher figure when it's a deliberate round-up above the total.
  if v_full and v_cumulative <= v_total + 0.5 then
    v_tranche    := round(v_total - v_already, 2);
    v_cumulative := v_total;
  end if;
  v_over := round(greatest(v_cumulative - v_total, 0), 2);

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
    case
      when v_over > 0
        then 'WS fully approved - released Rs ' || v_tranche || ' (Rs ' || v_over || ' ABOVE the asked Rs ' || v_total || ', rounded up - awaiting IN4 entry)'
      when v_full
        then 'WS fully approved - final release Rs ' || v_tranche || ' (awaiting IN4 entry)'
      else 'WS release approved Rs ' || v_tranche || ' (cumulative Rs ' || v_cumulative || ' of Rs ' || v_total || ' - awaiting IN4 entry)'
    end,
    auth.uid(), auth.uid(), 'approved'
  );

  return jsonb_build_object(
    'ok', true,
    'new_status', v_to,
    'approved_so_far', v_cumulative,
    'released', v_tranche,
    'over_asked', v_over
  );
end $function$;
