-- Bills Approval goes live. Applied to the live database on 16 Sep 2026.
--
-- Aksha, 16 Sep 2026, on the look-and-feel preview: "A, B, C, E, F Build it."
-- Four of the five screens stand on the four things below; nothing on them
-- works without these, so they come first and together.
--
-- 1. THE DESKS CAN GET IN.  `head` had view 0 / edit 0 on the module and
--    `engineer` had no row at all, so the Atm Heads and the Site Heads — the
--    people the flow exists for — could not open it, and the sidebar hid it
--    from them. A targeted grant for exactly those two roles: not a seed, not
--    an `on conflict do update` over everything (see the permissions footgun),
--    two rows Aksha asked for.
--
-- 2. THE MOVE GATE IS THE DESK, NOT THE MATRIX.  bb_rpc_move demanded
--    can_edit from role_permissions before it even looked at the desk. Being
--    on the desk is the permission now; the matrix's edit bit is kept for the
--    ERP entry team and admins, who are on no desk but do move bills.
--    The gate also resolves the desk WITH the sub-project, the way the
--    notifier already did — the known gap where the person told about a bill
--    and the person allowed to move it could be two different people.
--
-- 3. NO FORWARD FROM THE DISC HEAD WITHOUT THE STAMPED BILL.  Screen B. The
--    documents panel existed and nothing was ever attached, because nothing
--    asked. The Disc Head is the natural place: first CT desk, and the last
--    point where the paper is still in the building.
--
-- 4. A SEND-BACK CAN BE PULLED BACK FOR TEN MINUTES.  Screen B. Every one of
--    the 43 movements on record was a forward, and a mis-click on Send back
--    or Reject had no route home. `undo` reverses the actor's own last
--    send-back within ten minutes, and is itself recorded.
--
-- 5. BILLS RAISE THEMSELVES FROM IN4.  Screen A's "arrived from IN4". IN4
--    raised 597 bills in 90 days; nobody will type them twice. When an
--    approved abstract appears in the mirror for a bill CT Hub does not have,
--    the bill is created at the Disc Head desk with the measurement already
--    stamped — the same fingerprint the sweep uses, so the two never disagree.
--    Two guards keep history out: only abstracts dated on or after the go-live
--    watermark (app_settings 'bb_autoraise_since'), and never one whose
--    certificate IN4 has already marked Paid. Work orders only for now — a
--    supplier bill has no bill number until the supplier invoices, so there is
--    nothing yet to raise it under.
--
-- What is NOT here: no new table, no column added to bb_bills, no change to
-- any table another module reads.

-- ── 1. the roles that sit at the desks ─────────────────────────────────────
update public.role_permissions
   set can_view = true, can_edit = true
 where module_slug = 'bills-booking' and role = 'head';

insert into public.role_permissions (module_slug, role, can_view, can_edit, can_admin)
values ('bills-booking', 'engineer', true, true, false)
on conflict do nothing;

-- ── 2 + 3 + 4. the move ─────────────────────────────────────────────────────
create or replace function public.bb_rpc_move(
  p_bill uuid, p_to public.bb_stage, p_action text default 'forward',
  p_comment text default null, p_certified numeric default null, p_net numeric default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
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

  -- The desk, resolved with the sub-project — the same call the notifier makes.
  select array_agg(m) into v_members from public.bb_stage_members(v_from, v_project, v_disc, v_sub) m;
  v_member := v_members is not null and v_actor = any(v_members);

  -- Being on the desk IS the permission. Admins and the matrix's editors (the
  -- ERP entry team) may also move it; a desk with members shuts everyone else out.
  if not (v_member or v_admin or v_edit) then
    raise exception 'You are not on the % desk for this bill', v_from;
  end if;
  if v_members is not null and array_length(v_members, 1) > 0 and not v_member and not v_admin then
    raise exception 'This bill is on the % desk — only its members or an admin can move it', v_from;
  end if;

  -- 4. undo: the actor's own send-back, within ten minutes, and nothing since.
  if p_action = 'undo' then
    select * into v_last from public.bb_bill_events
      where bill_id = p_bill order by created_at desc limit 1;
    if v_last is null or v_last.action <> 'send_back' then
      raise exception 'Nothing to undo — the last thing done to this bill was not a send-back';
    end if;
    if v_last.actor_id is distinct from v_actor then
      raise exception 'Only the person who sent it back can pull it back';
    end if;
    if v_last.created_at < now() - interval '10 minutes' then
      raise exception 'Too late to pull back — the ten minutes are up. The desk it went to has been told; ask them to forward it.';
    end if;
    v_to := v_last.from_stage;
    update public.bb_bills set current_stage = v_to, stage_since = now(), updated_at = now() where id = p_bill;
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (p_bill, v_from, v_to, 'undo', 'Send-back pulled back within ten minutes', null, v_actor);
    return jsonb_build_object('status','ok','from', v_from, 'to', v_to, 'notified', 0);
  end if;

  if p_action in ('send_back','hold','reject') and coalesce(btrim(p_comment),'') = '' then
    raise exception 'A reason is required to send back, hold or reject';
  end if;

  -- 3. the stamped bill, before the Disc Head lets it go forward.
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
    measured_ref     = case when v_to = 'site_head'
                            then public.bb_measurement_ref(order_type, order_no, bill_no)
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
end $$;

-- Attaching a document: the desk, or the matrix — same rule as moving.
create or replace function public.bb_rpc_add_doc(p_bill uuid, p_path text, p_name text, p_kind text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_actor uuid := auth.uid(); v_edit boolean; v_member boolean;
  v_from public.bb_stage; v_project uuid; v_disc text; v_sub integer;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select current_stage, project_id, discipline, in4_subproject_id into v_from, v_project, v_disc, v_sub
    from public.bb_bills where id = p_bill;
  if v_from is null then raise exception 'Bill not found'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and (rp.can_edit or rp.can_admin)) into v_edit;
  select exists (select 1 from public.bb_stage_members(v_from, v_project, v_disc, v_sub) m where m = v_actor) into v_member;
  if not (v_edit or v_member) then raise exception 'You do not have permission to attach documents to this bill'; end if;
  if coalesce(btrim(p_path),'') = '' then raise exception 'File is required'; end if;
  insert into public.bb_bill_docs(bill_id, path, name, kind, uploaded_by)
  values (p_bill, p_path, nullif(btrim(p_name),''), nullif(btrim(p_kind),''), v_actor);
  return jsonb_build_object('status','ok');
end $$;

-- ── who am I, on this module ────────────────────────────────────────────────
-- One call the pages make to know whether the caller sits anywhere: on a desk
-- by name, as the Atm Head of a sub-project, or as a Cost Control head. The
-- landing page uses it to say "yours"; the access gate uses it to let a desk
-- member in even when the matrix would not.
create or replace function public.bb_rpc_my_desks()
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'desks', coalesce((select jsonb_agg(jsonb_build_object(
                 'desk', desk, 'project_id', project_id, 'in4_subproject_id', in4_subproject_id))
               from public.bb_desk_members where user_id = auth.uid()), '[]'::jsonb),
    'atm_subprojects', coalesce((select jsonb_agg(subproject_id)
               from public.bb_project_desks where atm_head_id = auth.uid()), '[]'::jsonb),
    'atm_projects', coalesce((select jsonb_agg(project_id)
               from public.cc_project_approvers where user_id = auth.uid() and role = 'head'), '[]'::jsonb)
  );
$$;
grant execute on function public.bb_rpc_my_desks() to authenticated;

-- ── 5. bills raise themselves ───────────────────────────────────────────────
create or replace function public.bb_rpc_raise_from_in4()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_since date; r record; v_id uuid; v_raised int := 0; v_seen int := 0;
  v_project uuid; v_ref text; v_vendor text;
begin
  select nullif(btrim(value::text, '"'), '')::date into v_since
    from public.app_settings where key = 'bb_autoraise_since';
  -- No watermark: raise nothing. Going live is a decision somebody makes, not
  -- a side effect of the function existing.
  if v_since is null then
    return jsonb_build_object('status','ok','raised',0,'checked',0,'note','bb_autoraise_since is not set');
  end if;

  for r in
    select w.display_no as order_no, w.wo_id, w.subproject_id, w.contractor_id,
           w.wo_gross_value, w.wo_paid_amt, w.work_description,
           btrim(a.bill_no) as bill_no, max(a.display_no) as abstract_no, max(a.abstract_dt) as abstract_dt,
           sum(a.executed_amt) as measured
      from public.in4_wo_abstract_items a
      join public.in4_work_orders w on w.wo_id = a.wo_id
     where a.status = 'Approved'
       and coalesce(btrim(a.bill_no), '') <> ''
       and a.abstract_dt >= v_since
       and coalesce(lower(btrim(w.status_name)), '') not in ('cancelled','terminated')
       -- CT Hub does not already have it, under either spelling of the key.
       and not exists (select 1 from public.bb_bills b
                        where b.order_no = w.display_no
                          and lower(btrim(b.bill_no)) = lower(btrim(a.bill_no)))
       -- and IN4 has not already paid it: that is history, not a bill in flight.
       and not exists (select 1 from public.in4_wo_certificates c
                        where c.wo_id = w.wo_id
                          and lower(btrim(c.invoice_no)) = lower(btrim(a.bill_no))
                          and (lower(coalesce(c.status_name,'')) = 'paid' or coalesce(c.paid_amt,0) > 0))
     group by w.display_no, w.wo_id, w.subproject_id, w.contractor_id, w.wo_gross_value, w.wo_paid_amt,
              w.work_description, btrim(a.bill_no)
  loop
    v_seen := v_seen + 1;

    -- IN4's own chain to a CT Hub project; null when nothing claims it, which
    -- is most of the money — the sub-project desk carries it then.
    select p.id into v_project
      from public.in4_subproject_links l
      join public.cc_bph_project_links cb on cb.bph_project_id = l.bph_project_id
      join public.projects p on p.id = cb.cc_project_id and p.archived_at is null
     where l.subproject_id = r.subproject_id limit 1;

    select name into v_vendor from public.in4_parties where id = r.contractor_id limit 1;
    v_ref := public.bb_measurement_ref('WO', r.order_no, r.bill_no);

    insert into public.bb_bills(order_type, order_no, project_id, vendor_text, work, bill_no,
      claimed_amount, wo_value, paid_till_date, abstract_no_in4, in4_subproject_id,
      current_stage, stage_since, measured_ref, created_by)
    values ('WO', r.order_no, v_project, v_vendor, r.work_description, r.bill_no,
      coalesce(r.measured, 0), r.wo_gross_value, coalesce(r.wo_paid_amt, 0), r.abstract_no, r.subproject_id,
      'disc_head', now(), v_ref, null)
    returning id into v_id;

    -- Two events, so the timeline reads as it happened: measured at the Site
    -- Head in IN4, then moved on by IN4's approval. Actor null on both — nobody
    -- here did it, and the trail says so in words.
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (v_id, null, 'site_head', 'forward',
            'Raised from IN4 — abstract ' || coalesce(r.abstract_no, '?') || ' dated ' || to_char(r.abstract_dt, 'DD Mon YYYY')
              || '. Claimed is the measured basic value; tax is added at certification.',
            coalesce(r.measured, 0), null);
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (v_id, 'site_head', 'disc_head', 'forward', 'Abstract approved in IN4 — moved on automatically',
            coalesce(r.measured, 0), null);

    v_raised := v_raised + 1;
  end loop;

  return jsonb_build_object('status','ok','raised', v_raised, 'checked', v_seen, 'since', v_since);
end $$;
-- Service role only, like the sweep it runs beside.
revoke execute on function public.bb_rpc_raise_from_in4() from public, anon, authenticated;
