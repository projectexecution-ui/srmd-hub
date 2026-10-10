-- Example bills that show the Atm Head step in IN4 (Aksha, 10 Oct 2026:
-- "add Atm head approval stage and approved - if u can add examples").
--
-- `p->>'in4_state'`:
--   waiting  the certificate is in IN4, not yet approved: the sanctioned net
--            is on the bill and the ladder sits at "Atm approval (IN4)".
--   matched  approved in IN4 at the sanctioned net — the green banner.
--   differs  approved at another figure — the amber banner with the gap.
-- The certificate, its payable, who approved it and when are READ off the
-- mirror for the real order and bill number; nothing about IN4 is invented.
-- The events are written in the tracker's own words so the history reads as
-- it would on a live bill.
create or replace function public.bb_rpc_add_example(p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_stage bb_stage; v_since timestamptz;
  v_state text; v_type text; v_order text; v_billno text; v_po_id integer;
  v_cert_id integer; v_cert_no text; v_payable numeric; v_appr_at timestamptz; v_appr_by text;
  v_sanction numeric; v_verdict text; v_diff numeric; v_body text;
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles pr
                 where pr.id = v_actor and rp.role = pr.role
                   and rp.module_slug = 'bills-booking' and rp.can_admin = true) then
    raise exception 'Only a Bills Approval admin can add examples';
  end if;

  v_stage := coalesce(nullif(p->>'stage',''), 'submitted')::bb_stage;
  v_since := now() - (coalesce((p->>'days_at_desk')::int, 0) || ' days')::interval;
  v_state := nullif(p->>'in4_state', '');
  v_type := coalesce(nullif(p->>'order_type',''), 'WO');
  v_order := nullif(p->>'order_no',''); v_billno := nullif(p->>'bill_no','');

  -- The real certificate behind an IN4-state example.
  if v_state is not null and v_order is not null and v_billno is not null then
    if v_type = 'WO' then
      select c.certificate_id, c.display_no,
             round(coalesce(c.gross_bill_amt,0) - coalesce(c.retention_amt,0) - coalesce(c.advance_recovery_amt,0)
                   - coalesce(c.recoveries,0) - coalesce(c.deductions,0), 2)
        into v_cert_id, v_cert_no, v_payable
        from public.in4_wo_certificates c
       where c.kind = 'wo' and c.wo_no = v_order and lower(btrim(coalesce(c.invoice_no,''))) = lower(btrim(v_billno))
       order by c.creation_dt desc nulls last limit 1;
      if v_cert_id is not null then
        select e.at, e.actor_name into v_appr_at, v_appr_by from public.in4_cert_events e
         where e.certificate_id = v_cert_id and e.status_name in ('Approved','Processed','Paid','Partially Paid')
         order by e.at asc limit 1;
      end if;
    else
      select o.po_id into v_po_id from public.in4_purchase_orders o where o.po_no = v_order limit 1;
      select c.certificate_id, c.certificate_no, c.payable into v_cert_id, v_cert_no, v_payable
        from public.in4_supplier_pay_lines l join public.in4_supplier_certificates c on c.certificate_id = l.certificate_id
       where l.po_id = v_po_id and lower(btrim(coalesce(l.invoice_no,''))) = lower(btrim(v_billno))
       order by c.certificate_id desc limit 1;
    end if;
    if v_payable is null then
      -- No certificate in the mirror for this one: it still seeds, as a plain
      -- bill at its stage, rather than with figures made up.
      v_state := null;
    else
      v_sanction := case when v_state = 'differs' then v_payable + 4500 else v_payable end;
      v_appr_at := coalesce(v_appr_at, v_since);
    end if;
  end if;

  insert into public.bb_bills(
    order_type, bill_type, order_no, project_id, in4_subproject_id, vendor_text,
    discipline, discipline_id, work, bill_no, ra_no, bill_date, claimed_amount, net_amount,
    trust, wo_value, paid_till_date, ct_other_dept, abstract_no_in4,
    wo_pending, amendment_flag, current_stage, stage_since, is_example, created_by,
    sanctioned_net, sanctioned_at, sanctioned_by, in4_certificate_id,
    verdict, in4_payable, in4_approved_at, in4_approved_by)
  values (
    v_type, nullif(p->>'bill_type',''), v_order,
    nullif(p->>'project_id','')::uuid, nullif(p->>'in4_subproject_id','')::integer,
    nullif(p->>'vendor_text',''),
    nullif(p->>'discipline',''), nullif(p->>'discipline_id','')::uuid,
    nullif(p->>'work',''), v_billno, nullif(p->>'ra_no',''),
    nullif(p->>'bill_date','')::date,
    coalesce((p->>'claimed_amount')::numeric, 0),
    coalesce(v_sanction, nullif(p->>'net_amount','')::numeric),
    nullif(p->>'trust',''),
    nullif(p->>'wo_value','')::numeric,
    coalesce((p->>'paid_till_date')::numeric, 0),
    coalesce(nullif(p->>'ct_other_dept',''), 'CT'),
    nullif(p->>'abstract_no_in4',''),
    coalesce((p->>'wo_pending')::boolean, false),
    coalesce((p->>'amendment_flag')::boolean, false),
    v_stage, v_since, true, v_actor,
    v_sanction, case when v_sanction is not null then v_since - interval '1 day' end, case when v_sanction is not null then v_actor end, v_cert_id,
    case when v_state = 'matched' then 'matched' when v_state = 'differs' then 'amount_differs' end,
    case when v_state in ('matched','differs') then v_payable end,
    case when v_state in ('matched','differs') then v_appr_at end,
    case when v_state in ('matched','differs') then v_appr_by end)
  returning id into v_id;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id, created_at)
  values (v_id, null, 'submitted', 'forward',
          coalesce(nullif(p->>'note',''), 'Example bill, seeded for the walkthrough'),
          coalesce((p->>'claimed_amount')::numeric, 0), v_actor, v_since - interval '3 days');

  if v_state is not null then
    -- The trail as the live flow writes it: CT Head approval, certificate in
    -- IN4, and (matched / differs) the Atm Head's approval read back.
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id, created_at)
    values (v_id, 'ct_head', 'ct_billing', 'forward', 'Approved — net payable ' || public.fn_inr(v_sanction) || ' sanctioned', v_sanction, v_actor, v_since - interval '1 day');
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id, created_at)
    values (v_id, 'ct_billing', 'atm_in4', 'forward',
            'Certificate ' || coalesce(v_cert_no, '?') || ' raised in IN4 — payable ' || public.fn_inr(v_payable)
            || ' · waiting for the Atm Head to approve it in IN4', v_payable, null, v_since);
    if v_state in ('matched', 'differs') then
      v_diff := round(v_payable - v_sanction, 2);
      v_body := 'Certificate ' || coalesce(v_cert_no, '?') || ' approved in IN4'
             || case when v_appr_by is not null then ' by ' || v_appr_by else '' end
             || ' on ' || to_char(v_appr_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')
             || E'.\nIN4 payable ' || public.fn_inr(v_payable) || ' · CT Hub net ' || public.fn_inr(v_sanction)
             || case when v_state = 'matched' then ' · same figure.'
                     else ' · ' || public.fn_inr(abs(v_diff)) || case when v_diff > 0 then ' more in IN4.' else ' less in IN4.' end end;
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id, created_at)
      values (v_id, 'atm_in4', 'trust', 'forward', v_body, v_payable, null, v_since + interval '2 hours');
    end if;
  elsif v_stage <> 'submitted' then
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id, created_at)
    values (v_id, 'submitted', v_stage, 'forward', 'Moved along for the walkthrough',
            coalesce((p->>'claimed_amount')::numeric, 0), v_actor, v_since);
  end if;

  return v_id;
end $function$;

-- The two older example bills parked on the retired hub Atm step.
update public.bb_bills set current_stage = 'atm_in4' where current_stage = 'atm_approval' and coalesce(is_example, false);
