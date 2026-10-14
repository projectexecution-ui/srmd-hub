-- Bills Approval: Advance, Petty Cash, Misc and Retention release skip the
-- Site Head, and Advance / Petty Cash / Misc are followed in IN4
-- (Aksha's answers on the bill-type process page, 14 Oct 2026 —
-- https://claude.ai/artifact/CM1PBgGDMd7bBUn2SSbMKW):
--
--   Q1 "Skip the Site Head — Directly goes to CT Disc Head and then same
--      process ahead — just check in IN4 the Abstract is not made but other
--      process is followed".
--   Q2 "Follow them in IN4 after all".
--   Q3 Retention release: "Skip the Site Head".
--
-- Checked in IN4 first (14 Oct): 0 of 776 site-expense (petty cash / misc)
-- certificates and effectively none of 175 advances have an abstract, yet both
-- run IN4's same five steps — Submitted → Verify → Approved (Atm) → Processed
-- (Accounts) → Paid (145 of 174 advances, 730 of 866 site expenses).
--
-- Two switches in Bills settings (missing = on):
--   bb_rule_skip_site_head      — these four types are entered straight to the
--                                 CT Disc Head; a send-back from there goes to
--                                 Billing (Entered), not to a Site Head.
--   bb_rule_follow_advance_misc — the tracker follows IN4's advance certificate
--                                 (WO + bill no) and site-expense certificate
--                                 (bill no + amount, party first) through Atm
--                                 approval, Accounts and Paid, like a WO bill.
--
-- ── UNDO ──────────────────────────────────────────────────────────────────
--   update app_settings set value = 'false' where key in ('bb_rule_skip_site_head', 'bb_rule_follow_advance_misc');
--   -- with both off, entry and tracking behave exactly as on 13 Oct.

insert into public.app_settings (key, value) values
  ('bb_rule_skip_site_head',      'true'),
  ('bb_rule_follow_advance_misc', 'true')
on conflict (key) do nothing;

-- ── Entry: no Site Head for Advance, Petty Cash, Misc, Retention release ──
create or replace function public.bb_rpc_create_bill(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_actor uuid := auth.uid(); v_edit boolean; v_id uuid; v_owner uuid; v_owner_name text;
  v_wo numeric; v_paid numeric; v_claim numeric; v_otype text; v_pending boolean; v_amend boolean; v_stage bb_stage;
  v_type text := nullif(p->>'bill_type', '');
  v_skip boolean;
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
  -- These four have no measurement in IN4, so no Site Head (Aksha, 14 Oct 2026).
  v_skip := public.bb_rule_on('bb_rule_skip_site_head')
            and coalesce(v_type, '') in ('Advance', 'Petty Cash', 'Misc', 'Retention release');
  v_owner := case when v_skip then null else nullif(p->>'owner_id','')::uuid end;
  if v_owner is not null then
    select coalesce(full_name, email) into v_owner_name from public.profiles where id = v_owner;
    if v_owner_name is null then raise exception 'That Site Head is not a CT Hub user'; end if;
  end if;
  v_stage := case when v_skip then 'disc_head'::bb_stage
                  when v_owner is not null then 'site_head'::bb_stage else 'submitted'::bb_stage end;

  insert into public.bb_bills(order_type, bill_type, order_no, project_id, vendor_id, vendor_text, discipline,
    discipline_id, work, bill_no, ra_no, bill_date, claimed_amount, trust, wo_value, paid_till_date, bill_category,
    ct_other_dept, abstract_no_in4, in4_subproject_id, wo_pending, amendment_flag, created_by, owner_id, current_stage, stage_since)
  values (
    v_otype, v_type, nullif(p->>'order_no',''),
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

  if v_skip then
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (v_id, 'submitted', 'disc_head', 'forward',
            v_type || ' — no Site Head step; straight to the CT Disc Head', v_claim, v_actor);
    perform public.bb_tell(v_id, 'disc_head', 'bb_bill_arrived',
      coalesce(nullif(p->>'vendor_text',''), 'A bill') || ' — ' || coalesce(nullif(p->>'bill_no',''), 'bill') || ' is on your desk',
      coalesce(nullif(p->>'order_no',''), 'no order') || ' · ' || public.fn_inr(v_claim)
        || E'\n' || v_type || ' — there is no Site Head step for this type. Check it and send it to the CT Head.',
      v_actor);
  elsif v_owner is not null then
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

-- ── The tracker, v4: also advance and site-expense certificates ──────────
create or replace function public.bb_rpc_track_in4()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record; v_cert_id integer; v_cert_no text; v_status text; v_payable numeric; v_paid numeric; v_certified numeric; v_remarks text;
  v_appr_at timestamptz; v_appr_by text; v_po_id integer; v_sanction numeric; v_diff numeric; v_verdict text;
  v_last text; v_last_by text; v_last_at timestamptz; v_last_remark text; v_proc_at timestamptz; v_proc_by text;
  v_part boolean; v_left text; v_mfp text; v_kind text;
  -- True when IN4's trail is not mirrored for it, so the time is when CT Hub saw it.
  v_appr_seen boolean; v_proc_seen boolean;
  v_seen int := 0; v_raised int := 0; v_approved int := 0; v_paid_n int := 0; v_held int := 0; v_back int := 0; v_nudged int := 0;
  v_body text; v_title text;
  k_part boolean := public.bb_rule_on('bb_rule_part_paid');
  k_hold boolean := public.bb_rule_on('bb_rule_in4_hold');
  k_nudge boolean := public.bb_rule_on('bb_rule_accounts_nudge');
  k_ret boolean := public.bb_rule_on('bb_rule_retention_release');
  k_mfp boolean := public.bb_rule_on('bb_rule_mfp_remark');
  k_adv boolean := public.bb_rule_on('bb_rule_follow_advance_misc');
begin
  for r in
    select id, order_type, order_no, bill_no, bill_type, vendor_text, net_amount, sanctioned_net, claimed_amount, current_stage,
           in4_certificate_id, verdict, created_at, in4_hold_at, in4_processed_at, in4_approved_at, in4_accounts_nudged_at
      from public.bb_bills
     where current_stage in ('ct_billing', 'atm_in4', 'trust')
       and (coalesce(btrim(order_no), '') <> '' or (k_adv and bill_type in ('Petty Cash', 'Misc')))
       and (coalesce(btrim(bill_no), '') <> '' or (k_ret and bill_type = 'Retention release'))
       and not coalesce(is_example, false)
     for update
  loop
    v_seen := v_seen + 1;
    v_cert_id := null; v_cert_no := null; v_status := null; v_payable := null; v_paid := null; v_certified := null; v_remarks := null;
    v_appr_at := null; v_appr_by := null; v_last := null; v_last_by := null; v_last_at := null; v_last_remark := null;
    v_proc_at := null; v_proc_by := null; v_part := false; v_kind := null; v_appr_seen := false; v_proc_seen := false;

    if r.order_type = 'WO' then
      -- An advance is its own certificate in IN4, not a running bill (14 Oct 2026).
      v_kind := case when k_adv and r.bill_type = 'Advance' then 'advance' else 'wo' end;
      select c.certificate_id, c.display_no, c.status_name,
             round(coalesce(c.gross_bill_amt,0) - coalesce(c.retention_amt,0) - coalesce(c.advance_recovery_amt,0)
                   - coalesce(c.recoveries,0) - coalesce(c.deductions,0), 2), coalesce(c.paid_amt, 0), c.certified_amt, c.remarks
        into v_cert_id, v_cert_no, v_status, v_payable, v_paid, v_certified, v_remarks
        from public.in4_wo_certificates c
       where c.kind = v_kind and c.wo_no = r.order_no
         and lower(btrim(coalesce(c.invoice_no, ''))) = lower(btrim(coalesce(r.bill_no, '')))
         and lower(coalesce(c.status_name, '')) not in ('cancelled', 'reversed')
       order by c.creation_dt desc nulls last limit 1;
      if v_cert_id is null and v_kind = 'wo' and k_ret and r.bill_type = 'Retention release' then
        select c.certificate_id, c.display_no, c.status_name,
               round(coalesce(c.gross_bill_amt,0) - coalesce(c.retention_amt,0) - coalesce(c.advance_recovery_amt,0)
                     - coalesce(c.recoveries,0) - coalesce(c.deductions,0), 2), coalesce(c.paid_amt, 0), c.certified_amt, c.remarks
          into v_cert_id, v_cert_no, v_status, v_payable, v_paid, v_certified, v_remarks
          from public.in4_wo_certificates c
         where c.kind = 'wo' and c.wo_no = r.order_no and c.certificate_type = 'Retention'
           and lower(coalesce(c.status_name, '')) not in ('cancelled', 'reversed')
           and c.creation_dt >= (r.created_at at time zone 'Asia/Kolkata')::date - 3
           and not exists (select 1 from public.bb_bills x where x.id <> r.id and x.order_type = 'WO' and x.in4_certificate_id = c.certificate_id)
         order by c.creation_dt asc limit 1;
      end if;
    elsif r.order_type = 'Without WO/PO' and k_adv and r.bill_type in ('Petty Cash', 'Misc') then
      -- A petty-cash / misc bill is a site-expense certificate in IN4, with no
      -- order: matched on bill no and amount, the same party first, raised
      -- around the bill's entry and not already followed by another bill.
      v_kind := 'misc';
      select c.certificate_id, coalesce(c.display_no, c.invoice_no), c.status_name,
             round(coalesce(c.gross_bill_amt,0) - coalesce(c.recoveries,0) - coalesce(c.deductions,0), 2), coalesce(c.paid_amt, 0), c.certified_amt
        into v_cert_id, v_cert_no, v_status, v_payable, v_paid, v_certified
        from public.in4_wo_certificates c
       where c.kind = 'misc'
         and lower(btrim(coalesce(c.invoice_no, ''))) = lower(btrim(coalesce(r.bill_no, '')))
         and abs(coalesce(c.gross_bill_amt, 0) - coalesce(r.claimed_amount, 0)) <= 1
         and lower(coalesce(c.status_name, '')) not in ('cancelled', 'reversed')
         and c.creation_dt >= (r.created_at at time zone 'Asia/Kolkata')::date - 30
         and not exists (select 1 from public.bb_bills x where x.id <> r.id and x.bill_type in ('Petty Cash', 'Misc')
                                                            and x.in4_certificate_id = c.certificate_id)
       order by (lower(btrim(coalesce(c.contractor_name, ''))) = lower(btrim(coalesce(r.vendor_text, '')))) desc, c.creation_dt asc
       limit 1;
    elsif r.order_type = 'PO' then
      select o.po_id into v_po_id from public.in4_purchase_orders o where o.po_no = r.order_no limit 1;
      if v_po_id is not null then
        -- 2 Approved · 8 Processed · 15 Paid · 75 Partially Paid · 121 Hold · 60 ReSubmit · 6 Cancelled · 84 Reversed.
        select c.certificate_id, c.certificate_no, c.status::text, c.payable, coalesce(c.paid, 0), c.certified_amt
          into v_cert_id, v_cert_no, v_status, v_payable, v_paid, v_certified
          from public.in4_supplier_pay_lines l join public.in4_supplier_certificates c on c.certificate_id = l.certificate_id
         where l.po_id = v_po_id and lower(btrim(coalesce(l.invoice_no, ''))) = lower(btrim(r.bill_no))
           and coalesce(c.status::text, '') not in ('6', '84')
         group by c.certificate_id, c.certificate_no, c.status, c.payable, c.paid, c.certified_amt
         order by c.certificate_id desc limit 1;
        if v_cert_id is not null then
          v_last := case v_status when '2' then 'Approved' when '8' then 'Processed' when '15' then 'Paid' when '75' then 'Partially Paid'
                                  when '121' then 'Hold' when '60' then 'ReSubmit' when '113' then 'Verify' when '1' then 'Submitted' else v_status end;
          if v_status in ('2', '8', '15', '75') then v_appr_at := now(); v_appr_seen := true; end if;
          if v_status in ('8', '15', '75') then v_proc_at := now(); v_proc_seen := true; end if;
          v_part := v_status = '75';
        end if;
      end if;
    end if;

    -- Where IN4 has it now. Only work-order certificates have their trail
    -- mirrored (in4_cert_events); advance and site-expense ids are other number
    -- series, so they are read off the certificate's own status.
    if v_cert_id is not null and v_kind = 'wo' then
      select e.at, e.actor_name into v_appr_at, v_appr_by
        from public.in4_cert_events e
       where e.certificate_id = v_cert_id and e.status_name in ('Approved', 'Processed', 'Paid', 'Partially Paid')
       order by e.at asc limit 1;
      if v_appr_at is null and lower(coalesce(v_status, '')) in ('approved', 'processed', 'paid', 'partially paid') then
        v_appr_at := now(); v_appr_seen := true;
      end if;
      select e.status_name, e.actor_name, e.at, e.remark into v_last, v_last_by, v_last_at, v_last_remark
        from public.in4_cert_events e where e.certificate_id = v_cert_id order by e.at desc, e.event_id desc limit 1;
      v_last := coalesce(v_last, v_status);
      select e.at, e.actor_name into v_proc_at, v_proc_by
        from public.in4_cert_events e where e.certificate_id = v_cert_id and e.status_name = 'Processed'
       order by e.at desc limit 1;
      if v_proc_at is null and lower(coalesce(v_status, '')) in ('processed', 'paid', 'partially paid') then v_proc_at := now(); v_proc_seen := true; end if;
      v_part := lower(coalesce(v_last, '')) = 'partially paid' or lower(coalesce(v_status, '')) = 'partially paid';
    elsif v_cert_id is not null and v_kind in ('advance', 'misc') then
      v_last := v_status;
      if lower(coalesce(v_status, '')) in ('approved', 'processed', 'paid', 'partially paid') then v_appr_at := now(); v_appr_seen := true; end if;
      if lower(coalesce(v_status, '')) in ('processed', 'paid', 'partially paid') then v_proc_at := now(); v_proc_seen := true; end if;
      v_part := lower(coalesce(v_status, '')) = 'partially paid';
    end if;

    -- B2. Sent back in IN4: back to CT Billing, who is told why.
    if k_hold and v_cert_id is not null and v_last = 'ReSubmit' and r.current_stage in ('atm_in4', 'trust') then
      v_body := 'Sent back in IN4' || coalesce(' by ' || v_last_by, '')
             || coalesce(' on ' || to_char(v_last_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'), '')
             || ' — ' || coalesce(nullif(btrim(v_last_remark), ''), 'no reason given in IN4')
             || '. Certificate ' || coalesce(v_cert_no, '?') || '; correct it in IN4 and submit again — CT Hub follows it from there.';
      update public.bb_bills set current_stage = 'ct_billing', stage_since = now(), in4_hold_at = null, in4_hold_note = null, updated_at = now()
       where id = r.id;
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (r.id, r.current_stage, 'ct_billing', 'send_back', v_body, v_payable, null);
      perform public.bb_tell(r.id, 'ct_billing', 'bb_in4_sent_back',
              coalesce(r.vendor_text, 'A bill') || ' — sent back in IN4', v_body, null);
      v_back := v_back + 1;
      continue;
    end if;

    -- 1. The certificate has appeared: it waits for the Atm Head in IN4.
    if r.current_stage = 'ct_billing' and v_cert_id is not null and not (k_hold and v_last = 'ReSubmit') then
      update public.bb_bills set current_stage = 'atm_in4', stage_since = now(), in4_certificate_id = v_cert_id, updated_at = now() where id = r.id;
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (r.id, 'ct_billing', 'atm_in4', 'forward',
              case v_kind when 'advance' then 'Advance certificate ' when 'misc' then 'Site-expense certificate ' else 'Certificate ' end
              || coalesce(v_cert_no, '?') || ' raised in IN4 — payable ' || public.fn_inr(v_payable)
              || ' · waiting for the Atm Head to approve it in IN4', v_payable, null);
      perform public.bb_tell(r.id, 'atm_in4', 'bb_bill_arrived',
              coalesce(r.vendor_text, 'A bill') || ' — certificate ' || coalesce(v_cert_no, '') || ' is in IN4 for your approval',
              'IN4 payable ' || public.fn_inr(v_payable) || ' · CT Hub approved ' || public.fn_inr(coalesce(r.sanctioned_net, r.net_amount))
              || E'\nApprove it in IN4; CT Hub will confirm whether the two agree.', null);
      v_raised := v_raised + 1;
      r.current_stage := 'atm_in4';
    end if;

    -- B2. On Hold in IN4.
    if k_hold and v_cert_id is not null and r.current_stage in ('atm_in4', 'trust') then
      if v_last = 'Hold' and r.in4_hold_at is null then
        update public.bb_bills set in4_hold_at = coalesce(v_last_at, now()),
               in4_hold_note = coalesce(v_last_by, 'IN4') || ': ' || coalesce(nullif(btrim(v_last_remark), ''), 'no reason given'),
               updated_at = now() where id = r.id;
        v_body := 'Held in IN4' || coalesce(' by ' || v_last_by, '')
               || coalesce(' on ' || to_char(v_last_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'), '')
               || ' — ' || coalesce(nullif(btrim(v_last_remark), ''), 'no reason given in IN4') || '. Certificate ' || coalesce(v_cert_no, '?') || '.';
        insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
        values (r.id, r.current_stage, r.current_stage, 'in4_hold', v_body, v_payable, null);
        perform public.bb_tell(r.id, 'ct_billing', 'bb_in4_held', coalesce(r.vendor_text, 'A bill') || ' — on hold in IN4', v_body, null);
        r.in4_hold_at := now();
        v_held := v_held + 1;
      elsif v_last is distinct from 'Hold' and r.in4_hold_at is not null then
        update public.bb_bills set in4_hold_at = null, in4_hold_note = null, updated_at = now() where id = r.id;
        insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
        values (r.id, r.current_stage, r.current_stage, 'in4_unhold',
                'Hold lifted in IN4 — now ' || coalesce(v_last, '?') || coalesce(' (' || v_last_by || ')', '') || '.', v_payable, null);
        r.in4_hold_at := null;
      end if;
    end if;

    -- 2. Approved in IN4: compare with the CT Head's net, tell everyone, move on.
    if r.current_stage = 'atm_in4' and v_cert_id is not null and v_appr_at is not null then
      v_sanction := coalesce(r.sanctioned_net, r.net_amount);
      v_diff := round(coalesce(v_payable, 0) - coalesce(v_sanction, 0), 2);
      v_verdict := case when v_sanction is null then 'amount_differs' when abs(v_diff) <= 1 then 'matched' else 'amount_differs' end;
      v_title := coalesce(r.vendor_text, 'A bill') || ' — ' || case when v_verdict = 'matched' then 'IN4 approval matches CT Hub' else 'IN4 approval differs from CT Hub' end;
      v_body := 'Certificate ' || coalesce(v_cert_no, '?') || ' approved in IN4'
             || case when v_appr_by is not null then ' by ' || v_appr_by else '' end
             || case when v_appr_seen then ' (CT Hub saw it on ' || to_char(v_appr_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') || ')'
                     else ' on ' || to_char(v_appr_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') end
             || E'.\nIN4 payable ' || public.fn_inr(v_payable) || ' · CT Hub net ' || public.fn_inr(v_sanction)
             || case when v_verdict = 'matched' then ' · same figure.'
                     else ' · ' || public.fn_inr(abs(v_diff)) || case when v_diff > 0 then ' more in IN4.' else ' less in IN4.' end end;
      -- The MFP line lives on the work-order certificate's remark only.
      if k_mfp and v_kind = 'wo' then
        v_mfp := case
          when coalesce(v_remarks, '') ~* 'mfp' then E'\n★ MFP instruction is in IN4''s remark: “' || btrim(v_remarks) || '”'
          else E'\n⚠ No MFP instruction in IN4''s remark'
               || case when coalesce(btrim(v_remarks), '') <> '' then ' (it says “' || btrim(v_remarks) || '”)' else ' (it is blank)' end
               || ' — add “MFP AS PER COP INSTRUCTION BY …” before Accounts processes it.' end;
        v_body := v_body || v_mfp;
      end if;
      update public.bb_bills set current_stage = 'trust', stage_since = now(), in4_certificate_id = v_cert_id,
             verdict = v_verdict, in4_payable = v_payable, in4_approved_at = v_appr_at, in4_approved_by = v_appr_by, updated_at = now()
       where id = r.id;
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (r.id, 'atm_in4', 'trust', 'forward', v_body, v_payable, null);
      perform public.bb_tell(r.id, 'atm_in4', 'bb_in4_verdict', v_title, v_body, null);
      perform public.bb_tell(r.id, 'ct_billing', 'bb_in4_verdict', v_title, v_body, null);
      v_approved := v_approved + 1;
      r.current_stage := 'trust';
      r.in4_approved_at := v_appr_at;
    end if;

    -- B3. Accounts.
    if r.current_stage = 'trust' and v_cert_id is not null then
      if v_proc_at is not null and r.in4_processed_at is null then
        update public.bb_bills set in4_processed_at = v_proc_at, in4_processed_by = v_proc_by, updated_at = now() where id = r.id;
        insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
        values (r.id, 'trust', 'trust', 'in4_processed',
                'Processed in IN4' || coalesce(' by ' || v_proc_by, '')
                || case when v_proc_seen then ' (CT Hub saw it on ' || to_char(v_proc_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ')'
                        else ' on ' || to_char(v_proc_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') end || ' — waiting for payment.', v_payable, null);
        r.in4_processed_at := v_proc_at;
      elsif k_nudge and v_proc_at is null and r.in4_processed_at is null and r.in4_hold_at is null
            and r.in4_accounts_nudged_at is null and r.in4_approved_at is not null and r.in4_approved_at < now() - interval '5 days' then
        v_body := 'Certificate ' || coalesce(v_cert_no, '?') || ' was approved by the Atm Head on '
               || to_char(r.in4_approved_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ' — '
               || extract(day from now() - r.in4_approved_at)::int || ' days ago — and Accounts has not processed it in IN4 yet.';
        perform public.bb_tell(r.id, 'ct_billing', 'bb_accounts_waiting',
                coalesce(r.vendor_text, 'A bill') || ' — not yet processed by Accounts in IN4', v_body, null);
        update public.bb_bills set in4_accounts_nudged_at = now() where id = r.id;
        v_nudged := v_nudged + 1;
      end if;
    end if;

    -- 3. Paid in IN4 — in full, or in part, saying what is left.
    if r.current_stage = 'trust' and v_cert_id is not null
       and (lower(coalesce(v_last, '')) = 'paid' or lower(coalesce(v_status, '')) = 'paid' or v_status = '15'
            or (v_payable is not null and v_payable > 0 and v_paid >= v_payable - 1)
            or (k_part and v_part)) then
      v_left := case when v_payable is not null and v_paid < v_payable - 1 then public.bb_left_note(v_certified, v_payable - v_paid) end;
      update public.bb_bills set current_stage = 'paid', stage_since = now(), in4_hold_at = null, in4_hold_note = null, updated_at = now()
       where id = r.id;
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (r.id, 'trust', 'paid', 'forward',
              case when v_left is null
                   then 'Paid in IN4 — ' || public.fn_inr(v_paid) || ' on certificate ' || coalesce(v_cert_no, '?')
                   else 'Paid in part in IN4 — ' || public.fn_inr(v_paid) || ' of ' || public.fn_inr(v_payable)
                        || ' on certificate ' || coalesce(v_cert_no, '?') || ' · ' || v_left end,
              v_paid, null);
      v_paid_n := v_paid_n + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'ok', 'checked', v_seen, 'certified', v_raised, 'approved', v_approved, 'paid', v_paid_n,
                            'held', v_held, 'sent_back', v_back, 'accounts_nudged', v_nudged);
end $function$;

revoke execute on function public.bb_rpc_track_in4() from public, anon, authenticated;
grant execute on function public.bb_rpc_track_in4() to service_role;
