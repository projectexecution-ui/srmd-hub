-- Bills Approval — the flow as Aksha set it on 10 Oct 2026.
--
--   Billing enters the bill and names its OWNER (the Site Head), who is told.
--   → Site Head makes the abstract / GRN in IN4, PICKS the approved one from
--     IN4's own list, and sends on. The CT Disc Head is chosen automatically:
--     MEP / fit-out work → the MEP desk (Kanti), everything else → Civil (Ambrish).
--   → CT Disc Head works the sheet (retention, advance recovery, hold, GST —
--     all optional), sends to the CT Head, or back to the Site Head.
--   → CT Head approves (the net is locked as the sanction) or sends back.
--   → CT Billing makes the certificate in IN4; the Atm Head approves IN IN4
--     only. CT Hub reads IN4, compares IN4's payable with the sanctioned net,
--     tells the Atm Head and Billing whether they match, then follows the
--     money to Trust and Paid.
--   Every forward tells the next desk. Nobody clicks an Atm approval here.

-- ── columns ─────────────────────────────────────────────────────────────────
alter table public.bb_bills
  add column if not exists owner_id uuid references public.profiles(id),
  add column if not exists in4_grn_id integer,
  add column if not exists in4_certificate_id integer,
  add column if not exists sanctioned_net numeric,
  add column if not exists sanctioned_at timestamptz,
  add column if not exists sanctioned_by uuid,
  add column if not exists verdict text check (verdict in ('matched','amount_differs')),
  add column if not exists in4_payable numeric,
  add column if not exists in4_approved_at timestamptz,
  add column if not exists in4_approved_by text;

comment on column public.bb_bills.owner_id is 'The Site Head this bill was assigned to at entry (10 Oct 2026)';
comment on column public.bb_bills.in4_grn_id is 'The approved goods receipt the Site Head picked from IN4 (PO bills)';
comment on column public.bb_bills.sanctioned_net is 'Net payable as approved by the CT Head — what IN4''s certificate is checked against';

-- ── which Disc Head ─────────────────────────────────────────────────────────
-- Aksha, 10 Oct 2026: "MEPFIT is Kanti bhai - other than MEP is Ambrish (if
-- any query add Ambrish as default)". Decided from the bill's category name.
create or replace function public.bb_disc_side(p_disc text)
returns text language sql immutable as $$
  select case when lower(coalesce(p_disc, '')) ~ '(mep|electric|plumb|hvac|fire|mechanical|mgps|lift|fit)'
              then 'mep' else 'civil' end
$$;

-- ── who sits at a stage, for ONE bill ───────────────────────────────────────
drop function if exists public.bb_stage_members(bb_stage, uuid, text, integer);
create or replace function public.bb_stage_members(
  p_stage bb_stage, p_project uuid, p_disc text, p_subproject integer default null, p_bill uuid default null)
returns setof uuid
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_owner uuid; v_side text;
begin
  if p_stage = 'submitted' then
    return query select * from public.bb_desk_members_for('erp', p_project, p_subproject);
  elsif p_stage = 'site_head' then
    -- The bill's own owner first; the desk only when none was named.
    if p_bill is not null then
      select owner_id into v_owner from public.bb_bills where id = p_bill;
      if v_owner is not null then return query select v_owner; return; end if;
    end if;
    return query select * from public.bb_desk_members_for('site_head', p_project, p_subproject);
  elsif p_stage = 'disc_head' then
    v_side := public.bb_disc_side(p_disc);
    if exists (select 1 from public.bb_desk_members_for('disc_head_' || v_side, p_project, p_subproject)) then
      return query select * from public.bb_desk_members_for('disc_head_' || v_side, p_project, p_subproject);
    else
      return query select * from public.bb_desk_members_for('disc_head_civil', p_project, p_subproject)
                    union select * from public.bb_desk_members_for('disc_head_mep', p_project, p_subproject);
    end if;
  elsif p_stage = 'ct_head' then
    return query select * from public.bb_desk_members_for('ct_head', p_project, p_subproject);
  elsif p_stage in ('ct_billing','trust') then
    return query select * from public.bb_desk_members_for('ct_billing', p_project, p_subproject);
  elsif p_stage in ('atm_approval','atm_in4') then
    if p_subproject is not null and exists (
         select 1 from public.bb_project_desks where subproject_id = p_subproject and atm_head_id is not null) then
      return query select atm_head_id from public.bb_project_desks
        where subproject_id = p_subproject and atm_head_id is not null;
    elsif p_project is not null then
      return query select user_id from public.cc_project_approvers where project_id = p_project and role = 'head';
    end if;
  end if;
  return;
end $function$;

-- The two Disc Head desks, as hub-wide defaults. Ambrishkumar Mistry = Civil;
-- the MEP Head account = MEP (Kanti). A per-project row still overrides.
insert into public.bb_desk_members(desk, user_id)
select 'disc_head_civil', '6421ee90-ffa4-4185-b71d-c322b590bce0'
where not exists (select 1 from public.bb_desk_members where desk = 'disc_head_civil' and project_id is null and in4_subproject_id is null);
insert into public.bb_desk_members(desk, user_id)
select 'disc_head_mep', 'eb1d53b4-3175-49bd-887a-50f09b2eac4e'
where not exists (select 1 from public.bb_desk_members where desk = 'disc_head_mep' and project_id is null and in4_subproject_id is null);

-- ── a small helper: tell a desk ─────────────────────────────────────────────
create or replace function public.bb_tell(p_bill uuid, p_stage bb_stage, p_type text, p_title text, p_body text, p_skip uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid; v_told integer := 0; v_project uuid; v_disc text; v_sub integer;
begin
  select project_id, discipline, in4_subproject_id into v_project, v_disc, v_sub from public.bb_bills where id = p_bill;
  for v_uid in select m from public.bb_stage_members(p_stage, v_project, v_disc, v_sub, p_bill) m loop
    continue when v_uid is null or v_uid = p_skip;
    begin
      perform public.notify_user(v_uid, p_type, p_title, p_body, '/bills-booking/' || p_bill::text,
                                 'bills-booking', 'bb_bills', p_bill, jsonb_build_object('stage', p_stage::text));
      v_told := v_told + 1;
    exception when others then null;
    end;
  end loop;
  return v_told;
end $function$;
revoke all on function public.bb_tell(uuid, bb_stage, text, text, text, uuid) from public;

-- ── entry: owner named, Site Head told ──────────────────────────────────────
create or replace function public.bb_rpc_create_bill(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_actor uuid := auth.uid(); v_edit boolean; v_id uuid; v_owner uuid; v_owner_name text;
  v_wo numeric; v_paid numeric; v_claim numeric; v_otype text; v_pending boolean; v_amend boolean; v_stage bb_stage;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id=v_actor and rp.role=pr.role and rp.module_slug='bills-booking' and rp.can_edit=true) into v_edit;
  if not v_edit then raise exception 'You do not have permission to enter bills'; end if;

  v_otype := coalesce(nullif(p->>'order_type',''),'WO');
  v_wo    := (p->>'wo_value')::numeric;
  v_paid  := coalesce((p->>'paid_till_date')::numeric, 0);
  v_claim := coalesce((p->>'claimed_amount')::numeric, 0);
  v_pending := (v_otype = 'Without WO/PO');
  v_amend := (not v_pending) and v_wo is not null and v_wo > 0 and (v_paid + v_claim) > v_wo;
  v_owner := nullif(p->>'owner_id','')::uuid;
  if v_owner is not null then
    select coalesce(full_name, email) into v_owner_name from public.profiles where id = v_owner;
    if v_owner_name is null then raise exception 'That Site Head is not a CT Hub user'; end if;
  end if;
  -- With an owner the bill goes straight to the Site Head; without one it
  -- waits at Entered until somebody forwards it.
  v_stage := case when v_owner is not null then 'site_head'::bb_stage else 'submitted'::bb_stage end;

  insert into public.bb_bills(order_type, bill_type, order_no, project_id, vendor_id, vendor_text, discipline,
    discipline_id, work, bill_no, ra_no, bill_date, claimed_amount, trust, wo_value, paid_till_date, bill_category,
    ct_other_dept, abstract_no_in4, in4_subproject_id, wo_pending, amendment_flag, created_by, owner_id, current_stage, stage_since)
  values (
    v_otype, nullif(p->>'bill_type',''), nullif(p->>'order_no',''),
    nullif(p->>'project_id','')::uuid, nullif(p->>'vendor_id','')::uuid, nullif(p->>'vendor_text',''),
    nullif(p->>'discipline',''), nullif(p->>'discipline_id','')::uuid, nullif(p->>'work',''),
    nullif(p->>'bill_no',''), nullif(p->>'ra_no',''),
    nullif(p->>'bill_date','')::date, v_claim, nullif(p->>'trust',''),
    v_wo, v_paid, nullif(p->>'bill_category',''), nullif(p->>'ct_other_dept',''),
    nullif(p->>'abstract_no_in4',''), nullif(p->>'in4_subproject_id','')::integer,
    v_pending, v_amend, v_actor, v_owner, v_stage, now())
  returning id into v_id;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (v_id, null, 'submitted', 'forward', nullif(p->>'comment',''), v_claim, v_actor);

  if v_owner is not null then
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (v_id, 'submitted', 'site_head', 'forward', 'Assigned to ' || v_owner_name || ' as Site Head', v_claim, v_actor);
    if v_owner <> v_actor then
      begin
        perform public.notify_user(v_owner, 'bb_bill_assigned',
          coalesce(nullif(p->>'vendor_text',''), 'A bill') || ' — a bill is with you to process',
          'Bill ' || coalesce(nullif(p->>'bill_no',''), '—') || ' on ' || coalesce(nullif(p->>'order_no',''), 'no order')
            || ' · ' || public.fn_inr(v_claim) || E'\nMake the abstract / goods receipt in IN4, then pick it here and send it to the CT Disc Head.',
          '/bills-booking/' || v_id::text, 'bills-booking', 'bb_bills', v_id, jsonb_build_object('stage', 'site_head'));
      exception when others then null;
      end;
    end if;
  end if;

  return jsonb_build_object('status','ok','bill_id', v_id, 'amendment_needed', v_amend, 'wo_pending', v_pending, 'stage', v_stage::text);
end $function$;

-- ── the Site Head picks the approved measurement from IN4 ───────────────────
create or replace function public.bb_rpc_pick_measurement(p_bill uuid, p_abstract text default null, p_grn_id integer default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_actor uuid := auth.uid(); v_edit boolean; v_admin boolean; v_member boolean; v_members uuid[];
  v_stage bb_stage; v_project uuid; v_disc text; v_sub integer; v_type text; v_order text; v_billno text;
  v_label text; v_on date; v_amt numeric; v_grn_no text;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select current_stage, project_id, discipline, in4_subproject_id, order_type, order_no, bill_no
    into v_stage, v_project, v_disc, v_sub, v_type, v_order, v_billno
    from public.bb_bills where id = p_bill for update;
  if v_stage is null then raise exception 'That bill does not exist'; end if;
  if v_stage not in ('site_head', 'disc_head') then
    raise exception 'The measurement is picked at the Site Head desk (or corrected at the CT Disc Head) — this bill is at %', v_stage;
  end if;

  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_edit = true) into v_edit;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin = true) into v_admin;
  select array_agg(m) into v_members from public.bb_stage_members(v_stage, v_project, v_disc, v_sub, p_bill) m;
  v_member := v_members is not null and v_actor = any(v_members);
  if not (v_member or v_admin or v_edit) then raise exception 'You are not on the % desk for this bill', v_stage; end if;
  if v_members is not null and array_length(v_members, 1) > 0 and not v_member and not v_admin then
    raise exception 'This bill is with the % desk — only its members or an admin can pick the measurement', v_stage;
  end if;

  if v_type = 'WO' then
    if coalesce(btrim(p_abstract), '') = '' then raise exception 'Pick an abstract'; end if;
    select min(a.abstract_dt), sum(a.executed_amt) into v_on, v_amt
      from public.in4_wo_abstract_items a join public.in4_work_orders w on w.wo_id = a.wo_id
     where w.display_no = v_order and a.display_no = p_abstract and a.status = 'Approved';
    if v_amt is null then raise exception 'IN4 has no approved abstract % on %', p_abstract, v_order; end if;
    update public.bb_bills set abstract_no_in4 = p_abstract, in4_grn_id = null,
           measured_ref = 'wo:pick:' || p_abstract, updated_at = now() where id = p_bill;
    v_label := 'Abstract ' || p_abstract || ' picked from IN4 — approved, dated ' || to_char(v_on, 'DD Mon YYYY')
               || ', measured ' || public.fn_inr(v_amt);
  elsif v_type = 'PO' then
    if p_grn_id is null then raise exception 'Pick a goods receipt'; end if;
    select max(g.grn_no), min(g.grn_dt), sum(g.received_qty * i.net_rate) into v_grn_no, v_on, v_amt
      from public.in4_grn_items g
      join public.in4_purchase_orders o on o.po_id = g.po_id
      join public.in4_po_items i on i.po_id = g.po_id and i.material_id = g.material_id
     where o.po_no = v_order and g.grn_id = p_grn_id and g.status = 'Approved';
    if v_amt is null then raise exception 'IN4 has no approved goods receipt with that id on %', v_order; end if;
    update public.bb_bills set in4_grn_id = p_grn_id, abstract_no_in4 = v_grn_no,
           measured_ref = 'po:pick:' || p_grn_id::text, updated_at = now() where id = p_bill;
    v_label := 'Goods receipt ' || coalesce(v_grn_no, '?') || ' of ' || to_char(v_on, 'DD Mon YYYY')
               || ' picked from IN4 — approved, goods at PO rates ' || public.fn_inr(v_amt);
  else
    raise exception 'This bill has no work order or purchase order to measure against';
  end if;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, v_stage, v_stage, 'abstract', v_label, v_amt, v_actor);
  return jsonb_build_object('status', 'ok', 'measured', v_amt, 'on', v_on);
end $function$;
grant execute on function public.bb_rpc_pick_measurement(uuid, text, integer) to authenticated;

-- ── moving a bill ───────────────────────────────────────────────────────────
create or replace function public.bb_rpc_move(p_bill uuid, p_to bb_stage, p_action text DEFAULT 'forward'::text, p_comment text DEFAULT NULL::text, p_certified numeric DEFAULT NULL::numeric, p_net numeric DEFAULT NULL::numeric)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_actor uuid := auth.uid(); v_edit boolean; v_admin boolean; v_member boolean;
  v_from public.bb_stage; v_project uuid; v_disc text; v_members uuid[];
  v_sub integer; v_vendor text; v_billno text; v_orderno text; v_reason text; v_abs text; v_grn integer;
  v_net numeric; v_claim numeric; v_actor_name text;
  v_told int := 0; v_last record; v_to public.bb_stage := p_to;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;

  select current_stage, project_id, discipline, in4_subproject_id, vendor_text, bill_no, order_no,
         abstract_no_in4, in4_grn_id, net_amount, claimed_amount
    into v_from, v_project, v_disc, v_sub, v_vendor, v_billno, v_orderno, v_abs, v_grn, v_net, v_claim
    from public.bb_bills where id = p_bill for update;
  if v_from is null then raise exception 'Bill not found'; end if;

  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_edit = true) into v_edit;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin = true) into v_admin;

  if p_action = 'undo' then
    select * into v_last from public.bb_bill_events where bill_id = p_bill order by created_at desc limit 1;
    if v_last is null or v_last.action not in ('send_back', 'reject') then
      raise exception 'Nothing to undo — the last thing done to this bill was not a send-back or a reject';
    end if;
    if v_last.actor_id is distinct from v_actor then raise exception 'Only the person who did it can pull it back'; end if;
    if v_last.created_at < now() - interval '10 minutes' then
      raise exception 'Too late to pull back — the ten minutes are up. Ask the desk it went to, or enter it again.';
    end if;
    v_to := v_last.from_stage;
    update public.bb_bills set current_stage = v_to, stage_since = now(), updated_at = now() where id = p_bill;
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (p_bill, v_from, v_to, 'undo',
            case when v_last.action = 'reject' then 'Reject pulled back within ten minutes' else 'Send-back pulled back within ten minutes' end,
            null, v_actor);
    return jsonb_build_object('status','ok','from', v_from, 'to', v_to, 'notified', 0);
  end if;

  select array_agg(m) into v_members from public.bb_stage_members(v_from, v_project, v_disc, v_sub, p_bill) m;
  v_member := v_members is not null and v_actor = any(v_members);
  if not (v_member or v_admin or v_edit) then raise exception 'You are not on the % desk for this bill', v_from; end if;
  if v_members is not null and array_length(v_members,1) > 0 and not v_member and not v_admin then
    raise exception 'This bill is on the % desk — only its members or an admin can move it', v_from;
  end if;

  if p_action in ('send_back','hold','reject') and coalesce(btrim(p_comment),'') = '' then
    raise exception 'A reason is required to send back or reject';
  end if;

  -- Gates on the way forward.
  if p_action = 'forward' and v_from = 'site_head' and v_abs is null and v_grn is null then
    raise exception 'Pick the approved abstract or goods receipt from IN4 first — the bill goes to the CT Disc Head with its measurement';
  end if;
  if p_action = 'forward' and v_from = 'disc_head' and not exists (
       select 1 from public.bb_bill_docs where bill_id = p_bill and kind in ('bill','stamped_bill')) then
    raise exception 'Attach the stamped bill before forwarding — nothing leaves the Disc Head desk without it';
  end if;
  if p_action = 'forward' and v_from = 'ct_head' then
    v_net := coalesce(p_net, v_net);
    if v_net is null then
      raise exception 'Set the net payable before approving — save the sheet, or type the verified net on the bar';
    end if;
  end if;

  update public.bb_bills set
    current_stage    = v_to,
    stage_since      = now(),
    pre_hold_stage   = case when p_action = 'hold' then v_from when p_action = 'resume' then null else pre_hold_stage end,
    certified_amount = coalesce(p_certified, certified_amount),
    net_amount       = coalesce(p_net, net_amount),
    -- The CT Head's approval IS the sanction: this is the figure IN4's
    -- certificate will be checked against.
    sanctioned_net   = case when p_action = 'forward' and v_from = 'ct_head' then v_net else sanctioned_net end,
    sanctioned_at    = case when p_action = 'forward' and v_from = 'ct_head' then now() else sanctioned_at end,
    sanctioned_by    = case when p_action = 'forward' and v_from = 'ct_head' then v_actor else sanctioned_by end,
    measured_ref     = case when v_to = 'site_head' and p_action = 'send_back'
                            then public.bb_measurement_ref(order_type, order_no, bill_no)
                            when v_to = 'site_head' then null
                            else measured_ref end,
    updated_at       = now()
  where id = p_bill;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, v_from, v_to, p_action, nullif(btrim(coalesce(p_comment,'')),''), coalesce(p_net, p_certified), v_actor);

  select coalesce(full_name, email) into v_actor_name from public.profiles where id = v_actor;

  if p_action = 'send_back' then
    v_reason := nullif(btrim(coalesce(p_comment,'')), '');
    v_told := public.bb_tell(p_bill, v_to, 'bb_bill_sent_back',
      coalesce(nullif(btrim(v_vendor), ''), 'A bill') || ' — sent back to you',
      coalesce(v_reason, 'No reason given') || E'\n\n' || coalesce(nullif(btrim(v_orderno), ''), 'no order')
        || case when coalesce(btrim(v_billno),'') <> '' then ' · bill ' || btrim(v_billno) else '' end
        || ' · by ' || coalesce(v_actor_name, 'someone'),
      v_actor);
  elsif p_action = 'forward' and v_to not in ('paid', 'rejected') then
    -- Aksha's audit, 7 Oct 2026: a forward told nobody. Now the next desk hears.
    v_told := public.bb_tell(p_bill, v_to, 'bb_bill_arrived',
      coalesce(nullif(btrim(v_vendor), ''), 'A bill') || ' — ' || coalesce(nullif(btrim(v_billno), ''), 'bill') || ' is on your desk',
      coalesce(nullif(btrim(v_orderno), ''), 'no order') || ' · ' || public.fn_inr(coalesce(v_net, v_claim))
        || ' · from ' || coalesce(v_actor_name, 'the previous desk')
        || case when v_to = 'ct_billing' then E'\nApproved by the CT Head — make the certificate in IN4 as per the sheet.' else '' end,
      v_actor);
  end if;

  return jsonb_build_object('status','ok','from', v_from, 'to', v_to, 'notified', v_told);
end $function$;

-- ── deductions gate: members for THIS bill ──────────────────────────────────
create or replace function public.bb_rpc_save_deductions(
  p_bill uuid, p_gst numeric, p_retention_pct numeric, p_retention_amt numeric, p_deductions jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_actor uuid := auth.uid(); v_edit boolean; v_admin boolean; v_member boolean;
  v_stage bb_stage; v_project uuid; v_disc text; v_sub integer; v_members uuid[];
  v_money jsonb; v_words text;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select current_stage, project_id, discipline, in4_subproject_id into v_stage, v_project, v_disc, v_sub
    from public.bb_bills where id = p_bill for update;
  if v_stage is null then raise exception 'That bill does not exist'; end if;
  if v_stage not in ('disc_head', 'ct_head') then
    raise exception 'Deductions are set at the CT Disc Head or CT Head desk — this bill is at %', v_stage;
  end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_edit = true) into v_edit;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin = true) into v_admin;
  select array_agg(m) into v_members from public.bb_stage_members(v_stage, v_project, v_disc, v_sub, p_bill) m;
  v_member := v_members is not null and v_actor = any(v_members);
  if not (v_member or v_admin or v_edit) then raise exception 'You are not on the % desk for this bill', v_stage; end if;
  if v_members is not null and array_length(v_members, 1) > 0 and not v_member and not v_admin then
    raise exception 'This bill is on the % desk — only its members or an admin can set deductions', v_stage;
  end if;

  v_money := public.bb_recompute_bill_money(p_bill, p_gst, p_retention_pct, p_retention_amt, p_deductions);

  select string_agg(
           case r->>'kind' when 'advance' then 'advance recovery' when 'recovery' then 'other recovery' when 'hold' then 'hold' else 'debit' end
           || ' ' || public.fn_inr((r->>'amount')::numeric)
           || case when r->>'mode' = 'pct' then ' (' || (r->>'value') || '%)' else '' end
           || case when r->>'note' is not null then ' — ' || (r->>'note') else '' end, ', ')
    into v_words from jsonb_array_elements(v_money->'rows') r;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, v_stage, v_stage, 'deductions',
          'Deductions set — retention ' || public.fn_inr((v_money->>'retention')::numeric)
          || case when p_retention_amt is not null then ' (typed)' else ' (' || coalesce(p_retention_pct, 0) || '%)' end
          || case when v_words is not null then ', ' || v_words else ', no other deductions' end
          || ' · net payable ' || public.fn_inr((v_money->>'net')::numeric),
          (v_money->>'net')::numeric, v_actor);
  return jsonb_build_object('status', 'ok') || v_money;
end $function$;

-- ── money: 'hold' as a kind; a picked abstract / GRN as the basic ──────────
create or replace function public.bb_recompute_bill_money(
  p_bill uuid, p_gst numeric, p_retention_pct numeric, p_retention_amt numeric, p_deductions jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_basic numeric; v_gst numeric; v_gross numeric; v_ret numeric; v_ded numeric := 0; v_net numeric;
  v_order text; v_billno text; v_type text; v_po_id integer; v_abs text; v_grn integer;
  v_rows jsonb := '[]'::jsonb; d jsonb; v_amt numeric; v_kind text; v_mode text; v_val numeric;
begin
  select order_type, order_no, bill_no, abstract_no_in4, in4_grn_id into v_type, v_order, v_billno, v_abs, v_grn
    from public.bb_bills where id = p_bill;

  select sum(this_amt) into v_basic from public.bb_bill_lines where bill_id = p_bill;

  if v_basic is null and v_type = 'WO' then
    select sum(a.executed_amt) into v_basic
      from public.in4_wo_abstract_items a join public.in4_work_orders w on w.wo_id = a.wo_id
     where w.display_no = v_order and a.status = 'Approved'
       and ((v_abs is not null and a.display_no = v_abs)
            or (v_abs is null and lower(btrim(a.bill_no)) = lower(btrim(coalesce(v_billno, '')))));
  end if;

  if v_basic is null and v_type = 'PO' then
    select po_id into v_po_id from public.in4_purchase_orders where po_no = v_order limit 1;
    if v_po_id is not null then
      if v_grn is not null then
        select sum(g.received_qty * i.net_rate) into v_basic
          from public.in4_grn_items g join public.in4_po_items i on i.po_id = g.po_id and i.material_id = g.material_id
         where g.po_id = v_po_id and g.grn_id = v_grn and g.status = 'Approved';
      end if;
      if v_basic is null then
        select sum(l.certified_amt) into v_basic from public.in4_supplier_pay_lines l
         where l.po_id = v_po_id and coalesce(v_billno, '') <> ''
           and lower(btrim(coalesce(l.invoice_no, ''))) = lower(btrim(v_billno));
      end if;
      if v_basic is null then
        select sum(g.received_qty * i.net_rate) into v_basic
          from public.in4_grn_items g join public.in4_po_items i on i.po_id = g.po_id and i.material_id = g.material_id
         where g.po_id = v_po_id and g.status = 'Approved'
           and not exists (select 1 from public.in4_supplier_pay_lines l where l.po_id = g.po_id and l.grn_id = g.grn_id);
      end if;
    end if;
  end if;

  if v_basic is null then
    raise exception 'Nothing measured yet on this bill — fill This Qty, or wait for IN4''s abstract or goods receipt, before setting deductions';
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
    if v_kind not in ('advance','recovery','debit','hold') then raise exception 'Unknown deduction kind %', v_kind; end if;
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

  update public.bb_bills set certified_amount = v_basic, claimed_amount = v_gross, net_amount = v_net,
    gst_pct = p_gst, retention_pct = p_retention_pct, retention_amt = p_retention_amt, deductions = v_rows, updated_at = now()
  where id = p_bill;

  return jsonb_build_object('basic', v_basic, 'gst', v_gst, 'gross', v_gross,
                            'retention', v_ret, 'deductions', v_ded, 'net', v_net, 'rows', v_rows);
end $function$;
revoke all on function public.bb_recompute_bill_money(uuid, numeric, numeric, numeric, jsonb) from public;

-- ── auto-advance only for bills nobody owns (IN4-raised, legacy) ───────────
create or replace function public.bb_rpc_advance_measured()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_ref text; v_moved int := 0; v_seen int := 0;
begin
  for r in
    select id, order_type, order_no, bill_no, measured_ref, claimed_amount, current_stage
    from public.bb_bills
    where current_stage = 'site_head' and coalesce(btrim(order_no), '') <> ''
      -- A bill a person entered waits for its Site Head to pick the
      -- measurement and send it on (10 Oct 2026). Only ownerless bills move
      -- by themselves.
      and owner_id is null and created_by is null
    for update
  loop
    v_seen := v_seen + 1;
    v_ref := public.bb_measurement_ref(r.order_type, r.order_no, r.bill_no);
    continue when v_ref is null or v_ref is not distinct from r.measured_ref;
    update public.bb_bills set current_stage = 'disc_head', stage_since = now(), measured_ref = v_ref, updated_at = now() where id = r.id;
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (r.id, 'site_head', 'disc_head', 'forward',
            case when r.order_type = 'PO' then 'Goods receipt approved in IN4 — moved on automatically'
                 else 'Abstract approved in IN4 — moved on automatically' end, r.claimed_amount, null);
    perform public.bb_tell(r.id, 'disc_head', 'bb_bill_arrived', 'A bill is on your desk',
                           coalesce(r.order_no, '') || ' · bill ' || coalesce(r.bill_no, '—') || ' · measured in IN4', null);
    v_moved := v_moved + 1;
  end loop;
  return jsonb_build_object('status','ok','checked', v_seen, 'moved', v_moved);
end $function$;

-- ── after the CT Head: follow IN4 ───────────────────────────────────────────
-- ct_billing → atm_in4 when the certificate appears in IN4
-- atm_in4    → trust   when IN4 shows it approved: compare, tell, record
-- trust      → paid    when IN4 shows it paid
create or replace function public.bb_rpc_track_in4()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; v_cert_id integer; v_cert_no text; v_status text; v_payable numeric; v_paid numeric;
  v_appr_at timestamptz; v_appr_by text; v_po_id integer; v_sanction numeric; v_diff numeric; v_verdict text;
  v_seen int := 0; v_raised int := 0; v_approved int := 0; v_paid_n int := 0; v_body text; v_title text;
begin
  for r in
    select id, order_type, order_no, bill_no, vendor_text, net_amount, sanctioned_net, current_stage, in4_certificate_id, verdict
      from public.bb_bills
     where current_stage in ('ct_billing', 'atm_in4', 'trust')
       and coalesce(btrim(order_no), '') <> '' and coalesce(btrim(bill_no), '') <> ''
       and not coalesce(is_example, false)
     for update
  loop
    v_seen := v_seen + 1;
    v_cert_id := null; v_cert_no := null; v_status := null; v_payable := null; v_paid := null; v_appr_at := null; v_appr_by := null;

    if r.order_type = 'WO' then
      select c.certificate_id, c.display_no, c.status_name,
             round(coalesce(c.gross_bill_amt,0) - coalesce(c.retention_amt,0) - coalesce(c.advance_recovery_amt,0)
                   - coalesce(c.recoveries,0) - coalesce(c.deductions,0), 2), coalesce(c.paid_amt, 0)
        into v_cert_id, v_cert_no, v_status, v_payable, v_paid
        from public.in4_wo_certificates c
       where c.kind = 'wo' and c.wo_no = r.order_no
         and lower(btrim(coalesce(c.invoice_no, ''))) = lower(btrim(r.bill_no))
         and lower(coalesce(c.status_name, '')) not in ('cancelled', 'reversed')
       order by c.creation_dt desc nulls last limit 1;
      if v_cert_id is not null then
        select e.at, e.actor_name into v_appr_at, v_appr_by
          from public.in4_cert_events e
         where e.certificate_id = v_cert_id and e.status_name in ('Approved', 'Processed', 'Paid', 'Partially Paid')
         order by e.at asc limit 1;
        if v_appr_at is null and lower(coalesce(v_status, '')) in ('approved', 'processed', 'paid', 'partially paid') then
          v_appr_at := now();
        end if;
      end if;
    elsif r.order_type = 'PO' then
      select o.po_id into v_po_id from public.in4_purchase_orders o where o.po_no = r.order_no limit 1;
      if v_po_id is not null then
        select c.certificate_id, c.certificate_no, coalesce(max(l.status_name), c.status::text), c.payable, coalesce(c.paid, 0)
          into v_cert_id, v_cert_no, v_status, v_payable, v_paid
          from public.in4_supplier_pay_lines l join public.in4_supplier_certificates c on c.certificate_id = l.certificate_id
         where l.po_id = v_po_id and lower(btrim(coalesce(l.invoice_no, ''))) = lower(btrim(r.bill_no))
         group by c.certificate_id, c.certificate_no, c.status, c.payable, c.paid
         order by c.certificate_id desc limit 1;
        -- A supplier certificate is approved once IN4 processes or pays it (status 8 / 6 / 15).
        if v_cert_id is not null and (lower(coalesce(v_status, '')) in ('processed', 'paid', 'partially paid')
                                      or v_status in ('6', '8', '15')) then
          v_appr_at := now();
        end if;
      end if;
    end if;

    -- 1. The certificate has appeared: Billing has keyed it; it waits for the Atm Head in IN4.
    if r.current_stage = 'ct_billing' and v_cert_id is not null then
      update public.bb_bills set current_stage = 'atm_in4', stage_since = now(), in4_certificate_id = v_cert_id, updated_at = now() where id = r.id;
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (r.id, 'ct_billing', 'atm_in4', 'forward',
              'Certificate ' || coalesce(v_cert_no, '?') || ' raised in IN4 — payable ' || public.fn_inr(v_payable)
              || ' · waiting for the Atm Head to approve it in IN4', v_payable, null);
      perform public.bb_tell(r.id, 'atm_in4', 'bb_bill_arrived',
              coalesce(r.vendor_text, 'A bill') || ' — certificate ' || coalesce(v_cert_no, '') || ' is in IN4 for your approval',
              'IN4 payable ' || public.fn_inr(v_payable) || ' · CT Hub approved ' || public.fn_inr(coalesce(r.sanctioned_net, r.net_amount))
              || E'\nApprove it in IN4; CT Hub will confirm whether the two agree.', null);
      v_raised := v_raised + 1;
      r.current_stage := 'atm_in4';
    end if;

    -- 2. Approved in IN4: compare with the CT Head's net, tell everyone, move on.
    if r.current_stage = 'atm_in4' and v_cert_id is not null and v_appr_at is not null then
      v_sanction := coalesce(r.sanctioned_net, r.net_amount);
      v_diff := round(coalesce(v_payable, 0) - coalesce(v_sanction, 0), 2);
      v_verdict := case when v_sanction is null then 'amount_differs' when abs(v_diff) <= 1 then 'matched' else 'amount_differs' end;
      v_title := coalesce(r.vendor_text, 'A bill') || ' — ' || case when v_verdict = 'matched' then 'IN4 approval matches CT Hub' else 'IN4 approval differs from CT Hub' end;
      v_body := 'Certificate ' || coalesce(v_cert_no, '?') || ' approved in IN4'
             || case when v_appr_by is not null then ' by ' || v_appr_by else '' end
             || ' on ' || to_char(v_appr_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')
             || E'.\nIN4 payable ' || public.fn_inr(v_payable) || ' · CT Hub net ' || public.fn_inr(v_sanction)
             || case when v_verdict = 'matched' then ' · same figure.'
                     else ' · ' || public.fn_inr(abs(v_diff)) || case when v_diff > 0 then ' more in IN4.' else ' less in IN4.' end end;
      update public.bb_bills set current_stage = 'trust', stage_since = now(), in4_certificate_id = v_cert_id,
             verdict = v_verdict, in4_payable = v_payable, in4_approved_at = v_appr_at, in4_approved_by = v_appr_by, updated_at = now()
       where id = r.id;
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (r.id, 'atm_in4', 'trust', 'forward', v_body, v_payable, null);
      perform public.bb_tell(r.id, 'atm_in4', 'bb_in4_verdict', v_title, v_body, null);
      perform public.bb_tell(r.id, 'ct_billing', 'bb_in4_verdict', v_title, v_body, null);
      v_approved := v_approved + 1;
      r.current_stage := 'trust';
    end if;

    -- 3. Paid in IN4.
    if r.current_stage = 'trust' and v_cert_id is not null
       and (lower(coalesce(v_status, '')) = 'paid' or v_status in ('6', '15')
            or (v_payable is not null and v_payable > 0 and v_paid >= v_payable - 1)) then
      update public.bb_bills set current_stage = 'paid', stage_since = now(), updated_at = now() where id = r.id;
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (r.id, 'trust', 'paid', 'forward', 'Paid in IN4 — ' || public.fn_inr(v_paid) || ' on certificate ' || coalesce(v_cert_no, '?'), v_paid, null);
      v_paid_n := v_paid_n + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'ok', 'checked', v_seen, 'certified', v_raised, 'approved', v_approved, 'paid', v_paid_n);
end $function$;
revoke all on function public.bb_rpc_track_in4() from public;
