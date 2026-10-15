-- bb_rpc_move: the checklist is the gate at the Site Head. Applied live on
-- 15 Oct 2026, with 20261015_bb_doc_checklist.sql (which defines the
-- checklist, the waivers, and bb_tell_waivers).
--
-- Body as live on 15 Oct 2026, with three changes marked ── CHECKLIST ──:
--   1. site_head → forward needs every checklist document attached or explained;
--   2. disc_head → forward: the stamped-bill and No-Due checks become the one
--      checklist check (identical for bills that skipped the Site Head);
--   3. leaving the Site Head with reasons tells the Disc Head, Project Head
--      and Atm Head what is missing and why.
create or replace function public.bb_rpc_move(
  p_bill uuid, p_to public.bb_stage, p_action text default 'forward',
  p_comment text default null, p_certified numeric default null, p_net numeric default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid(); v_edit boolean; v_admin boolean; v_member boolean;
  v_from public.bb_stage; v_project uuid; v_disc text; v_members uuid[];
  v_sub integer; v_vendor text; v_billno text; v_orderno text; v_reason text; v_abs text; v_grn integer;
  v_net numeric; v_claim numeric; v_actor_name text; v_missing text;
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
  if p_action = 'forward' and v_from = 'site_head' and v_abs is null and v_grn is null
     and not (public.bb_rule_on('bb_rule_retention_release')
              and exists (select 1 from public.bb_bills x where x.id = p_bill and x.bill_type = 'Retention release')) then
    raise exception 'Pick the approved abstract or goods receipt from IN4 first — the bill goes to the CT Disc Head with its measurement';
  end if;
  -- ── CHECKLIST ── 1. Nothing leaves the Site Head with a document neither
  -- attached nor explained (Aksha, 15 Oct 2026).
  if p_action = 'forward' and v_from in ('site_head', 'disc_head') then
    select string_agg(label, ', ' order by label) into v_missing from public.bb_docs_missing(p_bill);
    if v_missing is not null then
      if v_from = 'site_head' then
        raise exception 'Attach these first, or give a reason for each: %', v_missing;
      else
        -- ── CHECKLIST ── 2. The Disc Head checks; a bill that skipped the Site
        -- Head still needs its stamped bill here.
        raise exception 'Missing from the checklist: % — attach before forwarding', v_missing;
      end if;
    end if;
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
    v_told := public.bb_tell(p_bill, v_to, 'bb_bill_arrived',
      coalesce(nullif(btrim(v_vendor), ''), 'A bill') || ' — ' || coalesce(nullif(btrim(v_billno), ''), 'bill') || ' is on your desk',
      coalesce(nullif(btrim(v_orderno), ''), 'no order') || ' · ' || public.fn_inr(coalesce(v_net, v_claim))
        || ' · from ' || coalesce(v_actor_name, 'the previous desk')
        || case when v_to = 'ct_billing' then E'\nApproved by the CT Head — make the certificate in IN4 as per the sheet.' else '' end,
      v_actor);
    -- ── CHECKLIST ── 3. Documents missing with a reason: the three desks are told.
    if v_from = 'site_head' then
      v_told := v_told + public.bb_tell_waivers(p_bill, v_actor);
    end if;
  end if;

  return jsonb_build_object('status','ok','from', v_from, 'to', v_to, 'notified', v_told);
end $$;
