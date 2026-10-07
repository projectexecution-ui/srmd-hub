-- Deductions on the abstract sheet — Aksha, 7 Oct 2026: "build the deductions
-- - also give PERCENTAGE option also - this all should come to CT Disc Head
-- and CT Head".
--
-- Until now the sheet stopped at Retention (a percentage only), so the Disc
-- Head, CT Head and Atm Head approved a net payable with no advance recovery,
-- no other recovery and no debit in it; the real net appeared only after CT
-- Billing made the certificate in IN4. On Desai RA-3 the sheet said
-- ₹14,20,254 and IN4 paid ₹13,83,061.
--
--   • bb_bills.retention_amt — retention typed as rupees (wins over the %)
--   • bb_bills.deductions    — [{kind, mode, value, note, amount}]
--       kind  advance | recovery | debit
--       mode  pct (of the basic value of this bill) | amt (rupees)
--   • bb_recompute_bill_money(bill, gst, ret%, ret₹, deductions) — ONE place
--     that turns the measured basic into certified / claimed(gross) / net.
--     The basic comes from CT Hub's own lines when it has them, else from
--     IN4's approved abstract for this bill number — so the 52 bills that
--     raised themselves from IN4 (sheet read-only) can still carry deductions.
--   • bb_rpc_save_abstract — unchanged signature plus optional ret₹ and
--     deductions; now defers the money to the recompute.
--   • bb_rpc_save_deductions — for a sheet whose lines are IN4's. Allowed at
--     the Disc Head and CT Head desks only, by the desk's members (or an
--     admin; or an editor when the desk is empty — the same rule as bb_rpc_move).

alter table public.bb_bills
  add column if not exists retention_amt numeric,
  add column if not exists deductions jsonb not null default '[]'::jsonb;

comment on column public.bb_bills.retention_amt is 'Retention typed as rupees; wins over retention_pct when set (7 Oct 2026)';
comment on column public.bb_bills.deductions is 'Advance recovery / other recovery / debit rows: [{kind, mode, value, note, amount}] — amount is recomputed server-side';

create or replace function public.bb_recompute_bill_money(
  p_bill uuid, p_gst numeric, p_retention_pct numeric, p_retention_amt numeric, p_deductions jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_basic numeric; v_gst numeric; v_gross numeric; v_ret numeric; v_ded numeric := 0; v_net numeric;
  v_order text; v_billno text; v_rows jsonb := '[]'::jsonb; d jsonb; v_amt numeric; v_kind text; v_mode text; v_val numeric;
begin
  select order_no, bill_no into v_order, v_billno from public.bb_bills where id = p_bill;

  -- Basic value: CT Hub's own measurement first, else IN4's approved abstract
  -- for this bill number (the same join the auto-raise uses).
  select sum(this_amt) into v_basic from public.bb_bill_lines where bill_id = p_bill;
  if v_basic is null then
    select sum(a.executed_amt) into v_basic
      from public.in4_wo_abstract_items a
      join public.in4_work_orders w on w.wo_id = a.wo_id
     where w.display_no = v_order
       and lower(btrim(a.bill_no)) = lower(btrim(coalesce(v_billno, '')))
       and a.status = 'Approved';
  end if;
  if v_basic is null then
    raise exception 'Nothing measured yet on this bill — fill This Qty, or wait for the abstract in IN4, before setting deductions';
  end if;
  v_basic := round(v_basic, 2);

  v_gst   := round(v_basic * coalesce(p_gst, 0) / 100, 2);
  v_gross := round(v_basic + v_gst, 2);
  v_ret   := case when p_retention_amt is not null then round(greatest(p_retention_amt, 0), 2)
                  else round(v_basic * coalesce(p_retention_pct, 0) / 100, 2) end;

  for d in select * from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb)) loop
    v_kind := coalesce(d->>'kind', 'debit');
    v_mode := coalesce(d->>'mode', 'amt');
    v_val  := greatest(coalesce((d->>'value')::numeric, 0), 0);
    if v_kind not in ('advance','recovery','debit') then raise exception 'Unknown deduction kind %', v_kind; end if;
    if v_mode not in ('pct','amt') then raise exception 'A deduction is a percentage or an amount, not %', v_mode; end if;
    if v_mode = 'pct' and v_val > 100 then raise exception 'A deduction of % percent is more than the whole bill', v_val; end if;
    v_amt := case when v_mode = 'pct' then round(v_basic * v_val / 100, 2) else round(v_val, 2) end;
    v_ded := v_ded + v_amt;
    v_rows := v_rows || jsonb_build_object('kind', v_kind, 'mode', v_mode, 'value', v_val,
                                           'note', nullif(btrim(coalesce(d->>'note', '')), ''), 'amount', v_amt);
  end loop;

  v_net := round(v_gross - v_ret - v_ded, 2);
  if v_net < 0 then
    raise exception 'Deductions (%) and retention (%) come to more than the bill (%)', public.fn_inr(v_ded), public.fn_inr(v_ret), public.fn_inr(v_gross);
  end if;

  update public.bb_bills set
    certified_amount = v_basic,
    -- The claim IS the gross — Aksha works GST-inclusive.
    claimed_amount   = v_gross,
    net_amount       = v_net,
    gst_pct          = p_gst,
    retention_pct    = p_retention_pct,
    retention_amt    = p_retention_amt,
    deductions       = v_rows,
    updated_at       = now()
  where id = p_bill;

  return jsonb_build_object('basic', v_basic, 'gst', v_gst, 'gross', v_gross,
                            'retention', v_ret, 'deductions', v_ded, 'net', v_net, 'rows', v_rows);
end $function$;

revoke all on function public.bb_recompute_bill_money(uuid, numeric, numeric, numeric, jsonb) from public;

/** Save the abstract: replace the lines, then let the recompute do the money. */
create or replace function public.bb_rpc_save_abstract(
  p_bill uuid, p_gst numeric, p_retention numeric, p_lines jsonb,
  p_retention_amt numeric default null, p_deductions jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid(); v_edit boolean; v_stage bb_stage;
  v_lines integer := 0; v_money jsonb; v_ded jsonb;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role
      and rp.module_slug = 'bills-booking' and rp.can_edit = true) into v_edit;
  if not v_edit then raise exception 'You do not have permission to change bills'; end if;

  select current_stage, deductions into v_stage, v_ded from public.bb_bills where id = p_bill;
  if not found then raise exception 'That bill does not exist'; end if;

  delete from public.bb_bill_lines where bill_id = p_bill;

  insert into public.bb_bill_lines(
    bill_id, item_id, sr, particular, uom, ordered_qty, rate, ordered_amt,
    prior_qty, prior_amt, this_qty, this_amt)
  select
    p_bill,
    nullif(l->>'item_id','')::integer,
    coalesce((l->>'sr')::integer, 0),
    coalesce(nullif(btrim(l->>'particular'),''), 'Item'),
    nullif(l->>'uom',''),
    coalesce((l->>'ordered_qty')::numeric, 0),
    coalesce((l->>'rate')::numeric, 0),
    coalesce((l->>'ordered_amt')::numeric, 0),
    coalesce((l->>'prior_qty')::numeric, 0),
    coalesce((l->>'prior_amt')::numeric, 0),
    coalesce((l->>'this_qty')::numeric, 0),
    round(coalesce((l->>'this_qty')::numeric, 0) * coalesce((l->>'rate')::numeric, 0), 2)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  where coalesce((l->>'this_qty')::numeric, 0) <> 0;

  get diagnostics v_lines = row_count;

  -- Deductions not sent → the ones already on the bill stay (saving quantities
  -- must never silently wipe a recovery somebody typed).
  v_money := public.bb_recompute_bill_money(p_bill, p_gst, p_retention, p_retention_amt, coalesce(p_deductions, v_ded));

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, v_stage, v_stage, 'abstract',
          'Abstract saved — ' || v_lines || ' ' || case when v_lines = 1 then 'item' else 'items' end
          || ' measured, net payable ' || public.fn_inr((v_money->>'net')::numeric)
          || case when (v_money->>'deductions')::numeric > 0
                  then ' after deductions of ' || public.fn_inr((v_money->>'deductions')::numeric) else '' end,
          (v_money->>'net')::numeric, v_actor);

  return jsonb_build_object('status','ok', 'lines', v_lines) || v_money;
end $function$;

grant execute on function public.bb_rpc_save_abstract(uuid, numeric, numeric, jsonb, numeric, jsonb) to authenticated;

/** Deductions on a sheet whose lines are IN4's (or whose lines are not being
 *  touched). Disc Head and CT Head desks only. */
create or replace function public.bb_rpc_save_deductions(
  p_bill uuid, p_gst numeric, p_retention_pct numeric, p_retention_amt numeric, p_deductions jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid(); v_edit boolean; v_admin boolean; v_member boolean;
  v_stage bb_stage; v_project uuid; v_disc text; v_sub integer; v_members uuid[];
  v_money jsonb; v_words text;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;

  select current_stage, project_id, discipline, in4_subproject_id
    into v_stage, v_project, v_disc, v_sub
    from public.bb_bills where id = p_bill for update;
  if v_stage is null then raise exception 'That bill does not exist'; end if;
  if v_stage not in ('disc_head', 'ct_head') then
    raise exception 'Deductions are set at the CT Disc Head or CT Head desk — this bill is at %', v_stage;
  end if;

  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_edit = true) into v_edit;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin = true) into v_admin;
  select array_agg(m) into v_members from public.bb_stage_members(v_stage, v_project, v_disc, v_sub) m;
  v_member := v_members is not null and v_actor = any(v_members);
  if not (v_member or v_admin or v_edit) then
    raise exception 'You are not on the % desk for this bill', v_stage;
  end if;
  if v_members is not null and array_length(v_members, 1) > 0 and not v_member and not v_admin then
    raise exception 'This bill is on the % desk — only its members or an admin can set deductions', v_stage;
  end if;

  v_money := public.bb_recompute_bill_money(p_bill, p_gst, p_retention_pct, p_retention_amt, p_deductions);

  select string_agg(
           case r->>'kind' when 'advance' then 'advance recovery' when 'recovery' then 'other recovery' else 'debit' end
           || ' ' || public.fn_inr((r->>'amount')::numeric)
           || case when r->>'mode' = 'pct' then ' (' || (r->>'value') || '%)' else '' end
           || case when r->>'note' is not null then ' — ' || (r->>'note') else '' end,
           ', ')
    into v_words
    from jsonb_array_elements(v_money->'rows') r;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, v_stage, v_stage, 'deductions',
          'Deductions set — retention ' || public.fn_inr((v_money->>'retention')::numeric)
          || case when p_retention_amt is not null then ' (typed)' else ' (' || coalesce(p_retention_pct, 0) || '%)' end
          || case when v_words is not null then ', ' || v_words else ', no other deductions' end
          || ' · net payable ' || public.fn_inr((v_money->>'net')::numeric),
          (v_money->>'net')::numeric, v_actor);

  return jsonb_build_object('status', 'ok') || v_money;
end $function$;

grant execute on function public.bb_rpc_save_deductions(uuid, numeric, numeric, numeric, jsonb) to authenticated;
