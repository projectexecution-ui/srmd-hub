-- Record which IN4 sub-project a bill came from.
--
-- The entry form stopped asking "where does this book" on 14 Sep 2026 and
-- started reading it off the work order. The answer it reads is the IN4
-- sub-project, and for 30 of the 54 sub-projects that carry work orders there
-- is no CT Hub project to translate it into — so the sub-project is the only
-- thing tying the bill to a building.
--
-- bb_bills.in4_subproject_id already exists (20260914_bb_project_desks.sql).
-- Without this change the form passes it and the RPC drops it on the floor,
-- because it reads named keys out of the jsonb and ignores the rest. That is
-- the worst kind of failure: everything looks like it worked.
--
-- Nothing else about the function changes.

create or replace function public.bb_rpc_create_bill(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor uuid := auth.uid(); v_edit boolean; v_id uuid;
  v_wo numeric; v_paid numeric; v_claim numeric; v_otype text; v_pending boolean; v_amend boolean;
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

  insert into public.bb_bills(order_type, bill_type, order_no, project_id, vendor_id, vendor_text, discipline,
    discipline_id, work, bill_no, ra_no, bill_date, claimed_amount, trust, wo_value, paid_till_date, bill_category,
    ct_other_dept, abstract_no_in4, in4_subproject_id, wo_pending, amendment_flag, created_by)
  values (
    v_otype, nullif(p->>'bill_type',''), nullif(p->>'order_no',''),
    nullif(p->>'project_id','')::uuid, nullif(p->>'vendor_id','')::uuid, nullif(p->>'vendor_text',''),
    nullif(p->>'discipline',''), nullif(p->>'discipline_id','')::uuid, nullif(p->>'work',''),
    nullif(p->>'bill_no',''), nullif(p->>'ra_no',''),
    nullif(p->>'bill_date','')::date, v_claim, nullif(p->>'trust',''),
    v_wo, v_paid, nullif(p->>'bill_category',''), nullif(p->>'ct_other_dept',''),
    nullif(p->>'abstract_no_in4',''), nullif(p->>'in4_subproject_id','')::integer,
    v_pending, v_amend, v_actor)
  returning id into v_id;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (v_id, null, 'submitted', 'forward', nullif(p->>'comment',''), v_claim, v_actor);

  return jsonb_build_object('status','ok','bill_id', v_id, 'amendment_needed', v_amend, 'wo_pending', v_pending);
end $function$;
