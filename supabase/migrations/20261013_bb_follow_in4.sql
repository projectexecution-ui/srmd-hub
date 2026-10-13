-- Bills Approval: follow IN4 more closely (Aksha's picks on the IN4 bill
-- process review, 13 Oct 2026 — https://claude.ai/artifact/TeeVimf66ePsPc8YEXLy4T).
--
--   B1  Part-paid → Paid, saying what is left (TDS / still due)  bb_rule_part_paid
--   B2  IN4 Hold and send-backs shown on the bill; a send-back
--       returns the bill to CT Billing, who is told           bb_rule_in4_hold
--   B3  Accounts step: "Processed in IN4" recorded, and CT Billing
--       told when Accounts has not processed 5 days after the
--       Atm approval ("the Accounts team will not be in CT Hub")  bb_rule_accounts_nudge
--   F2  Attach the WO/PO to a "No WO yet" bill                 bb_rule_attach_order
--   F3  Follow WO/PO amendments: the bill takes the latest
--       approved value, and keeps the trail                     bb_rule_follow_amendments
--   F4  "Retention release" bill type, tracked to IN4's Retention
--       certificates; no measurement asked for                  bb_rule_retention_release
--       Full & Final needs the No-Due certificate at Disc Head   bb_rule_final_no_due
--   D3  IN4's approved abstract with the same bill no is taken
--       by itself at the Site Head desk                         bb_rule_auto_abstract
--   S1  (part) The Atm-approval notice shows IN4's certificate
--       remark and whether the MFP instruction is in it         bb_rule_mfp_remark
--
-- Also fixed: a supplier certificate in status 6 is CANCELLED in IN4, not paid
-- (the old tracker counted 6 as paid); and bb_rpc_track_in4 is now service-role
-- only — it was executable by anon / authenticated.
--
-- Everything is additive and every behaviour is a switch in Bills settings
-- (missing = on). IN4 stays read-only.
--
-- ── UNDO ──────────────────────────────────────────────────────────────────
-- Switch any one off in Bills settings (instant). To take it all out:
--   update app_settings set value = 'false' where key in ('bb_rule_part_paid','bb_rule_in4_hold',
--     'bb_rule_accounts_nudge','bb_rule_attach_order','bb_rule_follow_amendments','bb_rule_retention_release',
--     'bb_rule_final_no_due','bb_rule_auto_abstract','bb_rule_mfp_remark');
--   -- every new branch below is behind those keys, so with all off the
--   -- tracker behaves as before (bar the status-6 fix). Then, to remove:
--   drop function if exists public.bb_rpc_attach_order(uuid, text, text);
--   drop function if exists public.bb_rpc_follow_amendments();
--   drop function if exists public.bb_rpc_autopick_abstract();
--   drop function if exists public.bb_left_note(numeric, numeric);
--   -- bb_rpc_move: the two gates are removed by re-running the previous
--   -- definition (git show 978c37d7:… or pg history); bb_rpc_track_in4: same.
--   alter table public.bb_bills drop constraint bb_bills_bill_type_check;
--   alter table public.bb_bills add constraint bb_bills_bill_type_check check (bill_type = any (array['Running','Advance','Full & Final','Petty Cash','Misc']) or bill_type is null);
--   alter table public.bb_bills drop column if exists in4_hold_at, drop column if exists in4_hold_note,
--     drop column if exists in4_processed_at, drop column if exists in4_processed_by,
--     drop column if exists in4_accounts_nudged_at, drop column if exists wo_amendment_no;
--   drop table if exists public.in4_order_amendments;
--   alter table public.in4_wo_certificates drop column if exists remarks;

-- ── The switches (all on) ────────────────────────────────────────────────
insert into public.app_settings (key, value) values
  ('bb_rule_part_paid',          'true'),
  ('bb_rule_in4_hold',           'true'),
  ('bb_rule_accounts_nudge',     'true'),
  ('bb_rule_attach_order',       'true'),
  ('bb_rule_follow_amendments',  'true'),
  ('bb_rule_retention_release',  'true'),
  ('bb_rule_final_no_due',       'true'),
  ('bb_rule_auto_abstract',      'true'),
  ('bb_rule_mfp_remark',         'true')
on conflict (key) do nothing;

-- ── Mirror: the certificate's own remark, and every version of every order ─
alter table public.in4_wo_certificates add column if not exists remarks text;

create table if not exists public.in4_order_amendments (
  kind         text    not null check (kind in ('WO', 'PO')),
  order_id     integer not null,
  order_no     text,
  amendment_no integer not null,
  status_name  text,
  gross_value  numeric,
  value        numeric,
  approved_at  timestamptz,
  approved_by  text,
  remark       text,
  synced_at    timestamptz not null default now(),
  primary key (kind, order_id, amendment_no)
);
create index if not exists in4_order_amendments_no_idx on public.in4_order_amendments (kind, order_no);
alter table public.in4_order_amendments enable row level security;
drop policy if exists in4_order_amendments_read on public.in4_order_amendments;
create policy in4_order_amendments_read on public.in4_order_amendments
  for select to authenticated using ((select auth.uid()) is not null);
comment on table public.in4_order_amendments is
  'Mirror of IN4 ENGG_WO_AMENDMENT_HEADER / PURCH_PO_AMENDMENT_HEADER with each version''s value (ENGG_WORK_ORDER_AMENDMENT / PURCH_PURCHASE_ORDER_AMENDMENT) and who approved it, from the order trail. Version 0 = as first approved. Filled by the contractor (WO) and supplier (PO) feeds. Never write from the app.';

-- ── Bills: what the bill now knows about IN4 ─────────────────────────────
alter table public.bb_bills
  add column if not exists in4_hold_at            timestamptz,
  add column if not exists in4_hold_note          text,
  add column if not exists in4_processed_at       timestamptz,
  add column if not exists in4_processed_by       text,
  add column if not exists in4_accounts_nudged_at timestamptz,
  add column if not exists wo_amendment_no        integer;

alter table public.bb_bills drop constraint if exists bb_bills_bill_type_check;
alter table public.bb_bills add constraint bb_bills_bill_type_check
  check (bill_type = any (array['Running', 'Advance', 'Full & Final', 'Petty Cash', 'Misc', 'Retention release']) or bill_type is null);

-- ── What is left on a part-paid bill, in words ───────────────────────────
-- 1% / 2% of the basic within ₹2 is the contractor TDS rate IN4 never records
-- (Desai RA-1: ₹24,465 = 2% of ₹12,23,272). Anything else is just still due.
create or replace function public.bb_left_note(p_certified numeric, p_left numeric)
returns text language sql stable set search_path to 'public' as $$
  select case
    when p_left is null or p_left <= 1 then null
    when coalesce(p_certified, 0) * 0.02 >= 100 and abs(p_certified * 0.02 - p_left) <= 2
      then public.fn_inr(p_left) || ' left = 2% of the basic value — TDS, not recorded in IN4'
    when coalesce(p_certified, 0) * 0.01 >= 100 and abs(p_certified * 0.01 - p_left) <= 2
      then public.fn_inr(p_left) || ' left = 1% of the basic value — TDS, not recorded in IN4'
    else public.fn_inr(p_left) || ' still shown due in IN4'
  end
$$;

-- ── The tracker, v3 ──────────────────────────────────────────────────────
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
  v_part boolean; v_left text; v_mfp text;
  v_seen int := 0; v_raised int := 0; v_approved int := 0; v_paid_n int := 0; v_held int := 0; v_back int := 0; v_nudged int := 0;
  v_body text; v_title text;
  k_part boolean := public.bb_rule_on('bb_rule_part_paid');
  k_hold boolean := public.bb_rule_on('bb_rule_in4_hold');
  k_nudge boolean := public.bb_rule_on('bb_rule_accounts_nudge');
  k_ret boolean := public.bb_rule_on('bb_rule_retention_release');
  k_mfp boolean := public.bb_rule_on('bb_rule_mfp_remark');
begin
  for r in
    select id, order_type, order_no, bill_no, bill_type, vendor_text, net_amount, sanctioned_net, current_stage, in4_certificate_id, verdict,
           created_at, in4_hold_at, in4_processed_at, in4_approved_at, in4_accounts_nudged_at
      from public.bb_bills
     where current_stage in ('ct_billing', 'atm_in4', 'trust')
       and coalesce(btrim(order_no), '') <> ''
       and (coalesce(btrim(bill_no), '') <> '' or (k_ret and bill_type = 'Retention release'))
       and not coalesce(is_example, false)
     for update
  loop
    v_seen := v_seen + 1;
    v_cert_id := null; v_cert_no := null; v_status := null; v_payable := null; v_paid := null; v_certified := null; v_remarks := null;
    v_appr_at := null; v_appr_by := null; v_last := null; v_last_by := null; v_last_at := null; v_last_remark := null;
    v_proc_at := null; v_proc_by := null; v_part := false;

    if r.order_type = 'WO' then
      select c.certificate_id, c.display_no, c.status_name,
             round(coalesce(c.gross_bill_amt,0) - coalesce(c.retention_amt,0) - coalesce(c.advance_recovery_amt,0)
                   - coalesce(c.recoveries,0) - coalesce(c.deductions,0), 2), coalesce(c.paid_amt, 0), c.certified_amt, c.remarks
        into v_cert_id, v_cert_no, v_status, v_payable, v_paid, v_certified, v_remarks
        from public.in4_wo_certificates c
       where c.kind = 'wo' and c.wo_no = r.order_no
         and lower(btrim(coalesce(c.invoice_no, ''))) = lower(btrim(coalesce(r.bill_no, '')))
         and lower(coalesce(c.status_name, '')) not in ('cancelled', 'reversed')
       order by c.creation_dt desc nulls last limit 1;
      -- A retention release: IN4 numbers it "01/2026/27 Retention Release" and
      -- the typed no may not match, so take that order's Retention certificate
      -- raised from the bill's entry on, not already followed by another bill.
      if v_cert_id is null and k_ret and r.bill_type = 'Retention release' then
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
      if v_cert_id is not null then
        select e.at, e.actor_name into v_appr_at, v_appr_by
          from public.in4_cert_events e
         where e.certificate_id = v_cert_id and e.status_name in ('Approved', 'Processed', 'Paid', 'Partially Paid')
         order by e.at asc limit 1;
        if v_appr_at is null and lower(coalesce(v_status, '')) in ('approved', 'processed', 'paid', 'partially paid') then
          v_appr_at := now();
        end if;
        -- Where IN4 has it now, and who put it there.
        select e.status_name, e.actor_name, e.at, e.remark into v_last, v_last_by, v_last_at, v_last_remark
          from public.in4_cert_events e where e.certificate_id = v_cert_id order by e.at desc, e.event_id desc limit 1;
        v_last := coalesce(v_last, v_status);
        select e.at, e.actor_name into v_proc_at, v_proc_by
          from public.in4_cert_events e where e.certificate_id = v_cert_id and e.status_name = 'Processed'
         order by e.at desc limit 1;
        if v_proc_at is null and lower(coalesce(v_status, '')) in ('processed', 'paid', 'partially paid') then v_proc_at := now(); end if;
        v_part := lower(coalesce(v_last, '')) = 'partially paid' or lower(coalesce(v_status, '')) = 'partially paid';
      end if;
    elsif r.order_type = 'PO' then
      select o.po_id into v_po_id from public.in4_purchase_orders o where o.po_no = r.order_no limit 1;
      if v_po_id is not null then
        -- The certificate's own status code: 2 Approved · 8 Processed · 15 Paid ·
        -- 75 Partially Paid · 121 Hold · 60 ReSubmit · 6 Cancelled · 84 Reversed.
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
          if v_status in ('2', '8', '15', '75') then v_appr_at := now(); end if;
          if v_status in ('8', '15', '75') then v_proc_at := now(); end if;
          v_part := v_status = '75';
        end if;
      end if;
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

    -- 1. The certificate has appeared: Billing has keyed it; it waits for the Atm Head in IN4.
    --    (Not while IN4 still has it sent back — that is Billing's to fix first.)
    if r.current_stage = 'ct_billing' and v_cert_id is not null and not (k_hold and v_last = 'ReSubmit') then
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

    -- B2. On Hold in IN4: say so on the bill and tell CT Billing; lift it when IN4 does.
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
             || ' on ' || to_char(v_appr_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')
             || E'.\nIN4 payable ' || public.fn_inr(v_payable) || ' · CT Hub net ' || public.fn_inr(v_sanction)
             || case when v_verdict = 'matched' then ' · same figure.'
                     else ' · ' || public.fn_inr(abs(v_diff)) || case when v_diff > 0 then ' more in IN4.' else ' less in IN4.' end end;
      -- S1 (part): Accounts sends a bill back when the MFP instruction is not in
      -- the certificate's remark, so the approval notice shows the remark.
      if k_mfp and r.order_type = 'WO' then
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

    -- B3. Accounts: record "Processed in IN4" once; tell CT Billing if Accounts
    -- has not processed it 5 days after the Atm approval.
    if r.current_stage = 'trust' and v_cert_id is not null then
      if v_proc_at is not null and r.in4_processed_at is null then
        update public.bb_bills set in4_processed_at = v_proc_at, in4_processed_by = v_proc_by, updated_at = now() where id = r.id;
        insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
        values (r.id, 'trust', 'trust', 'in4_processed',
                'Processed in IN4' || coalesce(' by ' || v_proc_by, '')
                || ' on ' || to_char(v_proc_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ' — waiting for payment.', v_payable, null);
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

    -- 3. Paid in IN4 — in full, or (B1) in part, saying what is left.
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

-- ── F3. A bill follows its order's latest approved amendment ─────────────
create or replace function public.bb_rpc_follow_amendments()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_value numeric; v_no integer; v_at timestamptz; v_by text; v_remark text; v_flag boolean; v_n int := 0;
begin
  if not public.bb_rule_on('bb_rule_follow_amendments') then return jsonb_build_object('status', 'off'); end if;
  for r in
    select id, order_type, order_no, wo_value, paid_till_date, claimed_amount, current_stage, amendment_flag, wo_amendment_no
      from public.bb_bills
     where order_type in ('WO', 'PO') and coalesce(btrim(order_no), '') <> ''
       and current_stage not in ('paid', 'rejected') and not coalesce(is_example, false)
     for update
  loop
    v_value := null; v_no := null; v_at := null; v_by := null; v_remark := null;
    -- The order as IN4 holds it now is its latest approved version.
    if r.order_type = 'WO' then
      select round(w.wo_gross_value) into v_value from public.in4_work_orders w where w.display_no = r.order_no limit 1;
    else
      select round(o.po_value) into v_value from public.in4_purchase_orders o where o.po_no = r.order_no limit 1;
    end if;
    select a.amendment_no, a.approved_at, a.approved_by, a.remark into v_no, v_at, v_by, v_remark
      from public.in4_order_amendments a
     where a.kind = r.order_type and a.order_no = r.order_no and a.amendment_no > 0 and a.status_name = 'Amended & Approved'
     order by a.amendment_no desc limit 1;
    continue when v_value is null or v_value <= 0;
    continue when r.wo_value is not null and abs(v_value - r.wo_value) <= 1 and r.wo_amendment_no is not distinct from v_no;

    v_flag := r.order_type = 'WO' and coalesce(r.paid_till_date, 0) + coalesce(r.claimed_amount, 0) > v_value + 1;
    update public.bb_bills set wo_value = v_value, wo_amendment_no = v_no, amendment_flag = v_flag, updated_at = now() where id = r.id;
    -- A bill that never held the order's value just takes it; only a real
    -- change of value is an amendment worth a line in the trail.
    if r.wo_value is not null and abs(r.wo_value - v_value) > 1 then
      insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (r.id, r.current_stage, r.current_stage, 'amended',
              r.order_type || ' amended in IN4'
              || case when v_no is not null then ' — amendment ' || v_no
                   || coalesce(' approved ' || to_char(v_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'), '')
                   || coalesce(' by ' || v_by, '') else '' end
              || ': value ' || coalesce(public.fn_inr(r.wo_value), '—') || ' → ' || public.fn_inr(v_value)
              || coalesce(' · “' || v_remark || '”', '')
              || case when coalesce(r.amendment_flag, false) and not v_flag then ' · this bill is now within the order value.' else '' end,
              v_value, null);
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('status', 'ok', 'updated', v_n);
end $function$;

revoke execute on function public.bb_rpc_follow_amendments() from public, anon, authenticated;
grant execute on function public.bb_rpc_follow_amendments() to service_role;

-- ── D3. IN4's approved abstract with the same bill no is taken by itself ──
create or replace function public.bb_rpc_autopick_abstract()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_abs text; v_on date; v_amt numeric; v_n int := 0;
begin
  if not public.bb_rule_on('bb_rule_auto_abstract') then return jsonb_build_object('status', 'off'); end if;
  for r in
    select id, order_no, bill_no, current_stage, vendor_text from public.bb_bills
     where current_stage = 'site_head' and order_type = 'WO' and abstract_no_in4 is null
       and coalesce(btrim(order_no), '') <> '' and coalesce(btrim(bill_no), '') <> '' and not coalesce(is_example, false)
     for update
  loop
    select a.display_no into v_abs
      from public.in4_wo_abstract_items a join public.in4_work_orders w on w.wo_id = a.wo_id
     where w.display_no = r.order_no and a.status = 'Approved'
       and lower(btrim(coalesce(a.bill_no, ''))) = lower(btrim(r.bill_no))
     order by a.abstract_dt desc nulls last, a.abstract_id desc limit 1;
    continue when v_abs is null;
    select min(a.abstract_dt), sum(a.executed_amt) into v_on, v_amt
      from public.in4_wo_abstract_items a join public.in4_work_orders w on w.wo_id = a.wo_id
     where w.display_no = r.order_no and a.display_no = v_abs and a.status = 'Approved';
    update public.bb_bills set abstract_no_in4 = v_abs, in4_grn_id = null, measured_ref = 'wo:pick:' || v_abs, updated_at = now()
     where id = r.id;
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (r.id, 'site_head', 'site_head', 'abstract',
            'Abstract ' || v_abs || ' taken from IN4 by itself — approved in IN4 for bill ' || r.bill_no
            || coalesce(', dated ' || to_char(v_on, 'DD Mon YYYY'), '') || ', measured ' || public.fn_inr(v_amt), v_amt, null);
    perform public.bb_tell(r.id, 'site_head', 'bb_bill_arrived',
            coalesce(r.vendor_text, 'A bill') || ' — IN4''s approved abstract is on the bill',
            'Abstract ' || v_abs || ' (' || public.fn_inr(v_amt) || ') was taken from IN4. Check it and send the bill to the CT Disc Head.', null);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'picked', v_n);
end $function$;

revoke execute on function public.bb_rpc_autopick_abstract() from public, anon, authenticated;
grant execute on function public.bb_rpc_autopick_abstract() to service_role;

-- ── F2. Attach the WO / PO to a bill entered with none ───────────────────
create or replace function public.bb_rpc_attach_order(p_bill uuid, p_order_no text, p_reason text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid(); b record; v_admin boolean; v_desk boolean;
  v_no text := nullif(btrim(p_order_no), ''); v_kind text; v_value numeric; v_billed numeric := 0; v_sub integer; v_wo_id integer; v_po_id integer;
  v_flag boolean; v_note text;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  if not public.bb_rule_on('bb_rule_attach_order') then
    raise exception 'Attaching a work order is switched off in Bills settings';
  end if;
  select * into b from public.bb_bills where id = p_bill for update;
  if b.id is null then raise exception 'That bill does not exist'; end if;
  if b.order_type <> 'Without WO/PO' then raise exception 'This bill already has its order (%)', coalesce(b.order_no, b.order_type); end if;
  if b.current_stage in ('paid', 'rejected') then raise exception 'This bill is closed'; end if;
  if v_no is null then raise exception 'Pick the work order or purchase order'; end if;

  select exists (select 1 from public.role_permissions rp, public.profiles pr
                  where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin = true) into v_admin;
  select v_actor in (select m from public.bb_desk_members_for('erp', b.project_id, b.in4_subproject_id) m)
      or v_actor in (select m from public.bb_desk_members_for('ct_billing', b.project_id, b.in4_subproject_id) m)
    into v_desk;
  if not (coalesce(v_admin, false) or coalesce(v_desk, false) or coalesce(b.created_by = v_actor, false)) then
    raise exception 'Only Billing (who entered it, the ERP-entry or CT Billing desk) or an admin can attach the order';
  end if;

  select w.wo_id, round(w.wo_gross_value), w.subproject_id into v_wo_id, v_value, v_sub
    from public.in4_work_orders w where w.display_no = v_no limit 1;
  if v_wo_id is not null then
    v_kind := 'WO';
    select coalesce(round(sum(c.gross_bill_amt)), 0) into v_billed from public.in4_wo_certificates c
     where c.kind = 'wo' and c.wo_id = v_wo_id and lower(coalesce(c.status_name, '')) not in ('cancelled', 'reversed');
  else
    select o.po_id, round(o.po_value) into v_po_id, v_value from public.in4_purchase_orders o where o.po_no = v_no limit 1;
    if v_po_id is null then raise exception 'IN4 has no work order or purchase order numbered %', v_no; end if;
    v_kind := 'PO';
    select coalesce(round(sum(c.landed_cost)), 0) into v_billed from public.in4_supplier_certificates c
     where c.po_id = v_po_id and coalesce(c.kind, '') <> 'advance' and coalesce(c.status::text, '') not in ('6', '84');
  end if;

  v_flag := v_kind = 'WO' and v_value is not null and v_value > 0 and v_billed + coalesce(b.claimed_amount, 0) > v_value + 1;
  update public.bb_bills
     set order_type = v_kind, order_no = v_no, wo_value = v_value, paid_till_date = v_billed,
         wo_pending = false, amendment_flag = v_flag,
         -- IN4's sub-project for the order wins; the one picked at entry was a stand-in.
         in4_subproject_id = coalesce(v_sub, in4_subproject_id),
         updated_at = now()
   where id = p_bill;

  v_note := (case when v_kind = 'WO' then 'Work order ' else 'Purchase order ' end) || v_no || ' attached — the bill is no longer "to be regularised". '
         || 'Ordered ' || coalesce(public.fn_inr(v_value), '—') || ', billed before this ' || public.fn_inr(v_billed)
         || case when v_sub is not null and v_sub is distinct from b.in4_subproject_id
                 then '. The order books to IN4 sub-project ' || v_sub || ' (entered under ' || coalesce(b.in4_subproject_id::text, 'none') || ')' else '' end
         || case when v_flag then '. It takes the order past its value — an amendment is needed in IN4' else '' end
         || coalesce(' — ' || nullif(btrim(p_reason), ''), '');
  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, b.current_stage, b.current_stage, 'attach', v_note, b.claimed_amount, v_actor);
  return jsonb_build_object('status', 'ok', 'kind', v_kind, 'order_no', v_no, 'amendment_needed', v_flag);
end $function$;

revoke execute on function public.bb_rpc_attach_order(uuid, text, text) from public, anon;
grant execute on function public.bb_rpc_attach_order(uuid, text, text) to authenticated;

-- ── F4. bb_rpc_move: no measurement for a retention release; No-Due for F&F ─
-- Edited in place on the live definition, so nothing else in it can drift.
do $$
declare d text;
  a1 text := $a$if p_action = 'forward' and v_from = 'site_head' and v_abs is null and v_grn is null then$a$;
  b1 text := $b$if p_action = 'forward' and v_from = 'site_head' and v_abs is null and v_grn is null
     and not (public.bb_rule_on('bb_rule_retention_release')
              and exists (select 1 from public.bb_bills x where x.id = p_bill and x.bill_type = 'Retention release')) then$b$;
  a2 text := $a$raise exception 'Attach the stamped bill before forwarding — nothing leaves the Disc Head desk without it';
  end if;$a$;
  b2 text := $b$raise exception 'Attach the stamped bill before forwarding — nothing leaves the Disc Head desk without it';
  end if;
  -- A Full & Final bill: IN4 sends it back without the No-Due certificate (13 Oct 2026).
  if p_action = 'forward' and v_from = 'disc_head' and public.bb_rule_on('bb_rule_final_no_due')
     and exists (select 1 from public.bb_bills x where x.id = p_bill and x.bill_type = 'Full & Final')
     and not exists (select 1 from public.bb_bill_docs where bill_id = p_bill and kind = 'no_due') then
    raise exception 'Attach the No-Due certificate before forwarding a Full & Final bill — IN4 sends it back without one';
  end if;$b$;
begin
  d := pg_get_functiondef('public.bb_rpc_move(uuid, bb_stage, text, text, numeric, numeric)'::regprocedure);
  if position(a1 in d) = 0 then raise exception 'bb_rpc_move: site_head gate not found — not changed'; end if;
  if position(a2 in d) = 0 then raise exception 'bb_rpc_move: stamped-bill gate not found — not changed'; end if;
  if position('bb_rule_final_no_due' in d) = 0 then
    d := replace(d, a1, b1);
    d := replace(d, a2, b2);
    execute d;
  end if;
end $$;
