-- The Trustee approves the SAME figure the Atm Head checked.
--
-- Aksha, 7 Oct 2026, on SRAH-1302-Q02: "the amount checked by Project head n
-- Atm head is same and Chirag Shah amt is different - he has got diff amt to
-- approve - this cannot happen" and "Previous approved adjusted in this
-- Approval - that is not right - as this will create confusion".
--
-- What was wrong: the Trustee's balance was netted against money released on
-- EARLIER versions of the chain (v2 asked 10,80,450, v1 had 2,24,200 out, so
-- the Trustee was shown 8,56,250), and the Trustee could round UP above it
-- (8,60,000). The sheet then carried 2,24,200 + 8,60,000 = 10,84,200 as its
-- approved figure — a number nobody in the chain had checked. On v3–v5 the
-- same netting compounded into 21.6 L / 24.5 L / 28.5 L against sheets of
-- 10.8 L / 13.4 L / 17.2 L.
--
-- Now:
--   • the cap is the Atm Head's checked figure (atm_checked_amt, else the
--     sheet total) — one figure walks the whole chain, PH → Atm → Trustee;
--   • "already approved" is THIS sheet's own approved_for_erp_amt (a partial
--     approval earlier), never the chain's;
--   • above the cap is refused with the reason; a round-up belongs at the
--     Atm Head's check (RoundUpChips live there, Aksha 23 Sep 2026);
--   • approved_for_erp_amt on a version = that version's approved figure.
--     Across a chain the latest approved version restates the budget, so
--     roll-ups (max over live versions) and the IE-follow trigger keep working.
create or replace function public.cc_approve_release(p_ws_id uuid, p_tranche numeric DEFAULT NULL::numeric)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_ws         public.cc_working_sheets%rowtype;
  v_cap        numeric;
  v_already    numeric;
  v_remaining  numeric;
  v_tranche    numeric;
  v_cumulative numeric;
  v_full       boolean;
  v_from       text;
  v_to         text;
  v_bl_id      uuid;
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
    raise exception 'Only sheets signed off by the Atm Head (or already partly approved) can be approved by the Trustee';
  end if;
  if v_ws.engineer_id = auth.uid() and not public.fn_cc_is_admin(auth.uid()) then
    raise exception 'You cannot approve a sheet you raised yourself';
  end if;

  -- The figure the Atm Head signed. A sheet that reached this stage without a
  -- recorded check (older rows) falls back to its total.
  v_cap     := round(coalesce(v_ws.atm_checked_amt, v_ws.total_amount, 0)::numeric, 2);
  v_already := round(coalesce(v_ws.approved_for_erp_amt, 0)::numeric, 2);
  v_remaining := round(v_cap - v_already, 2);

  if v_cap <= 0 then
    raise exception 'Nothing to approve — the Atm Head''s checked figure on this sheet is zero';
  end if;
  if v_remaining <= 0.5 then
    raise exception 'Nothing left to approve — the Atm Head''s % is already approved on this sheet', public.fn_inr(v_cap);
  end if;

  v_tranche := round(coalesce(p_tranche, v_remaining)::numeric, 2);
  if v_tranche <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;
  if v_tranche > v_remaining + 0.5 then
    raise exception '% is more than the Atm Head checked. The Trustee approves the same figure (%); % is still to approve on this sheet. A round-up belongs at the Atm Head''s check.',
      public.fn_inr(v_tranche), public.fn_inr(v_cap), public.fn_inr(v_remaining);
  end if;

  v_cumulative := round(v_already + v_tranche, 2);
  v_full       := v_cumulative >= v_cap - 0.5;
  -- Snap a full approval to the checked figure exactly (no paise drift).
  if v_full then
    v_tranche    := v_remaining;
    v_cumulative := v_cap;
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
    raise exception 'Approval not applied — you are not authorized to approve this sheet, or it changed underneath you.';
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
      when v_full and v_already > 0
        then 'Approved the balance ' || public.fn_inr(v_tranche) || ' — sheet now fully approved at ' || public.fn_inr(v_cap) || ', the figure the Atm Head checked (awaiting IN4 entry)'
      when v_full
        then 'Approved ' || public.fn_inr(v_tranche) || ' — the figure the Atm Head checked (awaiting IN4 entry)'
      else 'Approved ' || public.fn_inr(v_tranche) || ' of the Atm Head''s ' || public.fn_inr(v_cap) || ' (' || public.fn_inr(v_cumulative) || ' approved so far · awaiting IN4 entry)'
    end,
    auth.uid(), auth.uid(), 'approved'
  );

  return jsonb_build_object(
    'ok', true,
    'new_status', v_to,
    'approved_so_far', v_cumulative,
    'released', v_tranche,
    'checked', v_cap,
    'over_asked', 0
  );
end $function$;
