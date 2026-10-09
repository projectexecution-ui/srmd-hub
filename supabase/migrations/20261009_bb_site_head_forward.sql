-- A bill forwarded to the Site Head when IN4 had ALREADY approved its goods
-- receipt / abstract could never leave that desk.
--
-- Aksha, 9 Oct 2026, on RAWJI INDUSTRIES PO/SRASSK/CVR/2026-27/93: "i am
-- unable to go ahead". The bar said "IN4 has approved the goods receipt —
-- moves on at the next check", and hid the Forward button; the check never
-- moved it. Why: bb_rpc_move stamped measured_ref with the CURRENT IN4
-- fingerprint on EVERY move into site_head, and bb_rpc_advance_measured skips a
-- bill whose fingerprint has not changed (that rule exists so a measurement
-- that was sent back does not re-advance itself). On a first forward the
-- stamp means "already seen", so an approval that existed before the bill was
-- entered counts for nothing.
--
-- Now the stamp is taken only on a SEND-BACK to the Site Head — the one case
-- it was written for. A plain forward leaves it null, so whatever IN4 has
-- approved moves the bill on at the next check, and (ActionBar, same commit)
-- the Forward button is never hidden: a person can always push it on.
create or replace function public.bb_rpc_move(p_bill uuid, p_to bb_stage, p_action text DEFAULT 'forward'::text, p_comment text DEFAULT NULL::text, p_certified numeric DEFAULT NULL::numeric, p_net numeric DEFAULT NULL::numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid(); v_edit boolean; v_admin boolean; v_member boolean;
  v_from public.bb_stage; v_project uuid; v_disc text; v_members uuid[];
  v_sub integer; v_vendor text; v_billno text; v_orderno text; v_reason text;
  v_uid uuid; v_told int := 0; v_last record; v_to public.bb_stage := p_to;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;

  select current_stage, project_id, discipline, in4_subproject_id, vendor_text, bill_no, order_no
    into v_from, v_project, v_disc, v_sub, v_vendor, v_billno, v_orderno
    from public.bb_bills where id = p_bill for update;
  if v_from is null then raise exception 'Bill not found'; end if;

  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_edit = true) into v_edit;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin = true) into v_admin;

  -- The way home: the actor's own send-back OR reject, within ten minutes,
  -- and nothing done to the bill since. Checked BEFORE the desk gate, because
  -- after a send-back the bill sits on the earlier desk, which the person who
  -- sent it back is usually not on (Aksha's audit, 7 Oct 2026: undo failed
  -- for everyone but admins).
  if p_action = 'undo' then
    select * into v_last from public.bb_bill_events
      where bill_id = p_bill order by created_at desc limit 1;
    if v_last is null or v_last.action not in ('send_back', 'reject') then
      raise exception 'Nothing to undo — the last thing done to this bill was not a send-back or a reject';
    end if;
    if v_last.actor_id is distinct from v_actor then
      raise exception 'Only the person who did it can pull it back';
    end if;
    if v_last.created_at < now() - interval '10 minutes' then
      raise exception 'Too late to pull back — the ten minutes are up. Ask the desk it went to, or enter it again.';
    end if;
    v_to := v_last.from_stage;
    update public.bb_bills set current_stage = v_to, stage_since = now(), updated_at = now() where id = p_bill;
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (p_bill, v_from, v_to, 'undo',
            case when v_last.action = 'reject' then 'Reject pulled back within ten minutes'
                 else 'Send-back pulled back within ten minutes' end, null, v_actor);
    return jsonb_build_object('status','ok','from', v_from, 'to', v_to, 'notified', 0);
  end if;

  select array_agg(m) into v_members from public.bb_stage_members(v_from, v_project, v_disc, v_sub) m;
  v_member := v_members is not null and v_actor = any(v_members);

  if not (v_member or v_admin or v_edit) then
    raise exception 'You are not on the % desk for this bill', v_from;
  end if;
  if v_members is not null and array_length(v_members,1) > 0 and not v_member and not v_admin then
    raise exception 'This bill is on the % desk — only its members or an admin can move it', v_from;
  end if;

  if p_action in ('send_back','hold','reject') and coalesce(btrim(p_comment),'') = '' then
    raise exception 'A reason is required to send back or reject';
  end if;

  if v_from = 'disc_head' and p_action = 'forward' and not exists (
       select 1 from public.bb_bill_docs where bill_id = p_bill and kind in ('bill','stamped_bill')) then
    raise exception 'Attach the stamped bill before forwarding — nothing leaves the Disc Head desk without it';
  end if;

  update public.bb_bills set
    current_stage    = v_to,
    stage_since      = now(),
    pre_hold_stage   = case when p_action = 'hold' then v_from
                            when p_action = 'resume' then null
                            else pre_hold_stage end,
    certified_amount = coalesce(p_certified, certified_amount),
    net_amount       = coalesce(p_net, net_amount),
    -- Remember the measurement that was SENT BACK, so only a new approval in
    -- IN4 moves the bill on again. A plain forward into the Site Head desk
    -- leaves it null: whatever IN4 has approved counts.
    measured_ref     = case when v_to = 'site_head' and p_action = 'send_back'
                            then public.bb_measurement_ref(order_type, order_no, bill_no)
                            when v_to = 'site_head' then null
                            else measured_ref end,
    updated_at       = now()
  where id = p_bill;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, v_from, v_to, p_action, nullif(btrim(coalesce(p_comment,'')),''), coalesce(p_net, p_certified), v_actor);

  if p_action = 'send_back' then
    v_reason := nullif(btrim(coalesce(p_comment,'')), '');
    for v_uid in select m from public.bb_stage_members(v_to, v_project, v_disc, v_sub) m loop
      continue when v_uid = v_actor;
      begin
        perform public.notify_user(
          v_uid, 'bb_bill_sent_back',
          coalesce(nullif(btrim(v_vendor), ''), 'A bill') || ' — sent back to you',
          coalesce(v_reason, 'No reason given') ||
            E'\n\n' || coalesce(nullif(btrim(v_orderno), ''), 'no order') ||
            case when coalesce(btrim(v_billno),'') <> '' then ' · bill ' || btrim(v_billno) else '' end,
          '/bills-booking/' || p_bill::text,
          'bills-booking', 'bb_bills', p_bill,
          jsonb_build_object('from_stage', v_from::text, 'to_stage', v_to::text, 'reason', v_reason));
        v_told := v_told + 1;
      exception when others then null;
      end;
    end loop;
  end if;

  return jsonb_build_object('status','ok','from', v_from, 'to', v_to, 'notified', v_told);
end $function$;
