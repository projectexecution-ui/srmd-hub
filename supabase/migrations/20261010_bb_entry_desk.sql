-- Being on the ERP entry desk IS the permission to enter a bill.
--
-- Aksha, 10 Oct 2026, seated Parimal (role uploader) and the Billing Head
-- account (role contractor / "CT OFC") on the ERP entry desk. Neither role
-- has can_edit on bills-booking, so the New bill page opened for them (the
-- page already lets any desk member in) but bb_rpc_create_bill refused the
-- save. Same rule as bb_rpc_move since 16 Sep: the desk is the permission;
-- the matrix's edit bit stays for admins and for roles given it directly.
create or replace function public.bb_rpc_create_bill(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_actor uuid := auth.uid(); v_edit boolean; v_id uuid; v_owner uuid; v_owner_name text;
  v_wo numeric; v_paid numeric; v_claim numeric; v_otype text; v_pending boolean; v_amend boolean; v_stage bb_stage;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id=v_actor and rp.role=pr.role and rp.module_slug='bills-booking' and (rp.can_edit=true or rp.can_admin=true))
      or exists (select 1 from public.bb_desk_members m where m.user_id = v_actor and m.desk = 'erp')
    into v_edit;
  if not v_edit then raise exception 'You do not have permission to enter bills — ask an admin to seat you on the ERP entry desk'; end if;

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
