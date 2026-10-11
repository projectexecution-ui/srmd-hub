-- Bills Approval: tracking a bill that changes, and IN4's debit notes
-- (Aksha, 11 Oct 2026).
--
--   "if there is some error in Bill and if the Bill changes how can we solve
--    that - so the Bills are tracked properly" — then: all three, each in
--    Settings so it can be switched off ("can u make it in settings").
--   "there will be Debit note in IN4 which also comes - so how can u
--    incorporate that" — then: "Debit note is not necessary all bills have -
--    so plan accordingly" (shown only where a work order has one).
--
-- Three rules, each an app_settings switch, all ON at the start:
--   1. bb_rule_recheck_on_change  — a bill whose IN4 measurement or claimed
--      amount changes AFTER the CT Disc Head approved it goes back to the Disc
--      Head, flagged with old → new.
--   2. bb_rule_in4_cancelled      — a certificate cancelled in IN4 with no live
--      one under the same bill no flags the bill "Cancelled in IN4" and tells
--      CT Billing; re-raised under the same no, the flag clears by itself.
--   3. bb_rule_billing_correct    — Billing (who entered it, the ERP-entry or
--      CT Billing desk) or an admin can correct the amount, bill no and bill
--      date, every change kept old → new with a reason.
--
-- Debit notes: read-only mirror of IN4's ENGG_WO_DEBIT_NOTE and its
-- recoveries (ENGG_WO_PAYMENT_DEBIT_NOTE_RECOVERY), filled by the contractor
-- feed alongside in4_wo_certificates. Nothing writes to IN4.

-- ── The switches ─────────────────────────────────────────────────────────
insert into public.app_settings (key, value) values
  ('bb_rule_recheck_on_change', 'true'),
  ('bb_rule_in4_cancelled',     'true'),
  ('bb_rule_billing_correct',   'true')
on conflict (key) do nothing;

create or replace function public.bb_rule_on(p_key text)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  -- Missing = on: the rule ships on, and a lost row must not silently stop it.
  select coalesce((select lower(btrim(value, '" ')) from app_settings where key = p_key), 'true') <> 'false';
$$;

-- ── What the Disc Head approved, and the two flags ───────────────────────
alter table public.bb_bills
  add column if not exists checked_measure    numeric,
  add column if not exists checked_claim      numeric,
  add column if not exists checked_at         timestamptz,
  add column if not exists checked_by         uuid references public.profiles(id),
  add column if not exists changed_note       text,
  add column if not exists changed_at         timestamptz,
  add column if not exists in4_cancelled_at   timestamptz,
  add column if not exists in4_cancelled_note text;

-- IN4's measurement for this bill, now: the picked abstract (or, before the
-- picker, the bill number's abstract) for a WO; the picked goods receipt at
-- PO rates for a PO. Null when IN4 has none.
create or replace function public.bb_current_measure(p_bill uuid)
returns numeric
language plpgsql
stable security definer
set search_path = public
as $$
declare b record; v numeric;
begin
  select order_type, order_no, bill_no, abstract_no_in4, in4_grn_id into b from bb_bills where id = p_bill;
  if b.order_type = 'WO' then
    if coalesce(btrim(b.abstract_no_in4), '') <> '' then
      select sum(a.executed_amt) into v
        from in4_wo_abstract_items a join in4_work_orders w on w.wo_id = a.wo_id
       where w.display_no = b.order_no and a.display_no = b.abstract_no_in4 and a.status = 'Approved';
    elsif coalesce(btrim(b.bill_no), '') <> '' then
      select sum(a.executed_amt) into v
        from in4_wo_abstract_items a join in4_work_orders w on w.wo_id = a.wo_id
       where w.display_no = b.order_no and lower(btrim(a.bill_no)) = lower(btrim(b.bill_no)) and a.status = 'Approved';
    end if;
  elsif b.order_type = 'PO' and b.in4_grn_id is not null then
    select sum(g.received_qty * i.net_rate) into v
      from in4_grn_items g
      join in4_purchase_orders o on o.po_id = g.po_id
      join in4_po_items i on i.po_id = g.po_id and i.material_id = g.material_id
     where o.po_no = b.order_no and g.grn_id = b.in4_grn_id and g.status = 'Approved';
  end if;
  return round(v, 2);
end $$;

-- The moment the Disc Head sends it on, record what they approved — and clear
-- any "changed" flag, since they have now approved the new figure.
create or replace function public.fn_bb_record_checked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.action = 'forward' and new.from_stage = 'disc_head' and new.to_stage is distinct from 'disc_head' then
    update bb_bills
       set checked_measure = bb_current_measure(new.bill_id),
           checked_claim   = claimed_amount,
           checked_at      = now(),
           checked_by      = new.actor_id,
           changed_note    = null,
           changed_at      = null
     where id = new.bill_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_bb_record_checked on public.bb_bill_events;
create trigger trg_bb_record_checked
  after insert on public.bb_bill_events
  for each row execute function public.fn_bb_record_checked();

-- ── Rule 1: changed after the Disc Head approved → back to the Disc Head ──
create or replace function public.bb_check_changed(p_bill uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare b record; v_now numeric; v_m boolean; v_c boolean; v_note text;
begin
  if not bb_rule_on('bb_rule_recheck_on_change') then return false; end if;
  select * into b from bb_bills where id = p_bill for update;
  -- After the Disc Head, before IN4's certificate takes over the checking.
  if b.id is null or b.checked_at is null or b.current_stage not in ('ct_head', 'ct_billing')
     or coalesce(b.is_example, false) then
    return false;
  end if;

  v_now := bb_current_measure(p_bill);
  v_m := v_now is not null and b.checked_measure is not null and abs(v_now - b.checked_measure) > 1;
  v_c := b.checked_claim is not null and abs(coalesce(b.claimed_amount, 0) - b.checked_claim) > 1;
  if not (v_m or v_c) then return false; end if;

  v_note := 'Changed after the CT Disc Head approved: '
    || concat_ws('; ',
         case when v_m then 'IN4 measurement ' || fn_inr(b.checked_measure) || ' → ' || fn_inr(v_now) end,
         case when v_c then 'bill amount ' || fn_inr(b.checked_claim) || ' → ' || fn_inr(b.claimed_amount) end);

  update bb_bills
     set current_stage = 'disc_head', stage_since = now(), updated_at = now(),
         changed_note = v_note, changed_at = now(),
         checked_measure = null, checked_claim = null, checked_at = null, checked_by = null,
         -- The CT Head's sanction was for the old figure.
         sanctioned_net = null, sanctioned_at = null, sanctioned_by = null
   where id = p_bill;

  insert into bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, b.current_stage, 'disc_head', 'send_back',
          v_note || ' — back to the Disc Head to approve the new figure.', coalesce(v_now, b.claimed_amount), null);

  perform bb_tell(p_bill, 'disc_head', 'bb_bill_changed', 'A bill changed after you approved it',
                  coalesce(b.order_no, '') || ' · bill ' || coalesce(b.bill_no, '—') || ' · ' || v_note, null);
  return true;
end $$;

-- ── Rule 2: cancelled in IN4 ─────────────────────────────────────────────
create or replace function public.bb_check_cancelled(p_bill uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare b record; v_live boolean; c record; v_at timestamptz; v_note text;
begin
  if not bb_rule_on('bb_rule_in4_cancelled') then return null; end if;
  select * into b from bb_bills where id = p_bill for update;
  if b.id is null or coalesce(b.order_type, '') <> 'WO' or coalesce(btrim(b.bill_no), '') = ''
     or b.current_stage not in ('ct_billing', 'atm_in4', 'trust') or coalesce(b.is_example, false) then
    return null;
  end if;

  select exists (select 1 from in4_wo_certificates x
                  where x.kind = 'wo' and x.wo_no = b.order_no
                    and lower(btrim(coalesce(x.invoice_no, ''))) = lower(btrim(b.bill_no))
                    and lower(coalesce(x.status_name, '')) not in ('cancelled', 'reversed'))
    into v_live;

  if v_live then
    -- Re-raised under the same bill no: follow it again.
    if b.in4_cancelled_at is not null then
      update bb_bills set in4_cancelled_at = null, in4_cancelled_note = null, updated_at = now() where id = p_bill;
      insert into bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
      values (p_bill, b.current_stage, b.current_stage, 'in4_reraised',
              'Raised again in IN4 under the same bill no ' || b.bill_no || ' — followed again.', b.claimed_amount, null);
      return 'reraised';
    end if;
    return null;
  end if;

  if b.in4_cancelled_at is not null then return null; end if;

  select x.certificate_id, x.display_no, x.status_name into c
    from in4_wo_certificates x
   where x.kind = 'wo' and x.wo_no = b.order_no
     and lower(btrim(coalesce(x.invoice_no, ''))) = lower(btrim(b.bill_no))
     and lower(coalesce(x.status_name, '')) in ('cancelled', 'reversed')
   order by x.creation_dt desc nulls last limit 1;
  if c.certificate_id is null then return null; end if;

  select max(e.at) into v_at from in4_cert_events e
   where e.certificate_id = c.certificate_id and e.status_name in ('Cancelled', 'Reversed');
  v_note := 'Certificate ' || coalesce(c.display_no, '?') || ' ' || lower(c.status_name) || ' in IN4'
            || coalesce(' on ' || to_char(v_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'), '')
            || '. If it is raised again under a new bill no, correct the bill no on this bill.';

  update bb_bills set in4_cancelled_at = coalesce(v_at, now()), in4_cancelled_note = v_note, updated_at = now()
   where id = p_bill;
  insert into bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, b.current_stage, b.current_stage, 'in4_cancelled', v_note, b.claimed_amount, null);
  perform bb_tell(p_bill, 'ct_billing', 'bb_bill_in4_cancelled', 'A bill was cancelled in IN4',
                  coalesce(b.order_no, '') || ' · bill ' || b.bill_no || ' · ' || v_note, null);
  return 'cancelled';
end $$;

-- ── The sweep: run with the IN4 check (cron + "Check IN4") ───────────────
create or replace function public.bb_rpc_check_changes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_back int := 0; v_cancel int := 0; v_re int := 0; v_res text;
begin
  for r in select id from bb_bills
            where current_stage in ('ct_head', 'ct_billing') and checked_at is not null
              and not coalesce(is_example, false)
  loop
    if bb_check_changed(r.id) then v_back := v_back + 1; end if;
  end loop;

  for r in select id from bb_bills
            where current_stage in ('ct_billing', 'atm_in4', 'trust') and order_type = 'WO'
              and not coalesce(is_example, false)
  loop
    v_res := bb_check_cancelled(r.id);
    if v_res = 'cancelled' then v_cancel := v_cancel + 1; elsif v_res = 'reraised' then v_re := v_re + 1; end if;
  end loop;

  return jsonb_build_object('status', 'ok', 'sent_back', v_back, 'cancelled', v_cancel, 'reraised', v_re);
end $$;
revoke execute on function public.bb_rpc_check_changes() from public, anon, authenticated;
revoke execute on function public.bb_check_changed(uuid) from public, anon, authenticated;
revoke execute on function public.bb_check_cancelled(uuid) from public, anon, authenticated;

-- ── Rule 3: Billing corrects its entry ───────────────────────────────────
create or replace function public.bb_rpc_correct_bill(
  p_bill uuid, p_claimed numeric, p_bill_no text, p_bill_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid(); b record; v_admin boolean; v_desk boolean;
  v_claim numeric := case when p_claimed is null then null else round(p_claimed, 2) end;
  v_no text := nullif(btrim(p_bill_no), '');
  v_parts text[] := '{}'; v_note text; v_back boolean;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  if not bb_rule_on('bb_rule_billing_correct') then
    raise exception 'Correcting a bill entry is switched off in Bills settings';
  end if;
  select * into b from bb_bills where id = p_bill for update;
  if b.id is null then raise exception 'That bill does not exist'; end if;

  select exists (select 1 from role_permissions rp, profiles pr
                  where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin = true)
    into v_admin;
  select v_actor in (select m from bb_desk_members_for('erp', b.project_id, b.in4_subproject_id) m)
      or v_actor in (select m from bb_desk_members_for('ct_billing', b.project_id, b.in4_subproject_id) m)
    into v_desk;
  -- coalesce: a bill IN4 raised has no created_by, and null would let anyone through.
  if not (coalesce(v_admin, false) or coalesce(v_desk, false) or coalesce(b.created_by = v_actor, false)) then
    raise exception 'Only Billing (who entered it, the ERP-entry or CT Billing desk) or an admin can correct this bill';
  end if;

  if b.current_stage not in ('submitted', 'site_head', 'disc_head', 'ct_head', 'ct_billing')
     and b.in4_cancelled_at is null then
    raise exception 'This bill is already with IN4 approval — a correction now happens in IN4 (cancel and raise again there)';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why it is being corrected — this is the record everyone reads later';
  end if;
  if v_claim is not null and v_claim <= 0 then raise exception 'Enter the bill amount'; end if;

  if v_claim is not null and v_claim is distinct from round(b.claimed_amount, 2) then
    v_parts := v_parts || ('amount ' || fn_inr(b.claimed_amount) || ' → ' || fn_inr(v_claim));
  else v_claim := null; end if;
  if v_no is not null and v_no is distinct from b.bill_no then
    if exists (select 1 from bb_bills x where x.id <> p_bill and x.order_no = b.order_no
                and lower(btrim(x.bill_no)) = lower(v_no)) then
      raise exception 'Another bill on % already has bill no %', b.order_no, v_no;
    end if;
    v_parts := v_parts || ('bill no ' || coalesce(b.bill_no, '—') || ' → ' || v_no);
  else v_no := null; end if;
  if p_bill_date is not null and p_bill_date is distinct from b.bill_date then
    v_parts := v_parts || ('bill date ' || coalesce(to_char(b.bill_date, 'DD Mon YYYY'), '—') || ' → ' || to_char(p_bill_date, 'DD Mon YYYY'));
  end if;
  if coalesce(array_length(v_parts, 1), 0) = 0 then raise exception 'Nothing was changed'; end if;

  update bb_bills
     set claimed_amount = coalesce(v_claim, claimed_amount),
         bill_no        = coalesce(v_no, bill_no),
         bill_date      = coalesce(p_bill_date, bill_date),
         -- A new bill no after a cancellation: follow IN4 under the new number.
         in4_cancelled_at   = case when v_no is not null then null else in4_cancelled_at end,
         in4_cancelled_note = case when v_no is not null then null else in4_cancelled_note end,
         in4_certificate_id = case when v_no is not null then null else in4_certificate_id end,
         updated_at = now()
   where id = p_bill;

  v_note := 'Corrected: ' || array_to_string(v_parts, '; ') || ' — ' || btrim(p_reason);
  insert into bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, b.current_stage, b.current_stage, 'correct', v_note, coalesce(v_claim, b.claimed_amount), v_actor);

  -- If the Disc Head had already approved the old figure, rule 1 takes it back.
  v_back := bb_check_changed(p_bill);
  return jsonb_build_object('status', 'ok', 'sent_back', v_back);
end $$;
grant execute on function public.bb_rpc_correct_bill(uuid, numeric, text, date, text) to authenticated;

-- ── IN4 debit notes (read-only mirror) ───────────────────────────────────
create table if not exists public.in4_wo_debit_notes (
  id            integer primary key,       -- ENGG_WO_DEBIT_NOTE.ID
  display_no    text,                      -- WDN/...
  wo_id         integer,                   -- DEBIT_TO_WO_ID — the contractor's order being debited
  contractor_id integer,
  amount        numeric not null default 0,
  status        integer,
  status_name   text,                      -- Processed / Verify / Cancelled
  note_type     text,                      -- Direct Debit / Advance / …
  reason        text,                      -- Material Sales / Free Supply / Quality / Settlement
  remarks       text,
  note_date     date,
  created_at    timestamptz,
  synced_at     timestamptz not null default now()
);
create index if not exists in4_wo_debit_notes_wo_idx on public.in4_wo_debit_notes (wo_id);

create table if not exists public.in4_wo_debit_note_recoveries (
  id             bigint primary key,       -- ENGG_WO_PAYMENT_DEBIT_NOTE_RECOVERY.ID
  debit_note_id  integer not null,
  certificate_id integer,                  -- WO_PAYMENT_AUTH_ID = in4_wo_certificates.certificate_id
  deducted_amt   numeric not null default 0,
  created_at     timestamptz,
  synced_at      timestamptz not null default now()
);
create index if not exists in4_wo_dn_rec_note_idx on public.in4_wo_debit_note_recoveries (debit_note_id);
create index if not exists in4_wo_dn_rec_cert_idx on public.in4_wo_debit_note_recoveries (certificate_id);

alter table public.in4_wo_debit_notes enable row level security;
alter table public.in4_wo_debit_note_recoveries enable row level security;
drop policy if exists in4_wo_debit_notes_read on public.in4_wo_debit_notes;
create policy in4_wo_debit_notes_read on public.in4_wo_debit_notes
  for select to authenticated using ((select auth.uid()) is not null);
drop policy if exists in4_wo_dn_rec_read on public.in4_wo_debit_note_recoveries;
create policy in4_wo_dn_rec_read on public.in4_wo_debit_note_recoveries
  for select to authenticated using ((select auth.uid()) is not null);

comment on table public.in4_wo_debit_notes is
  'Mirror of IN4 ENGG_WO_DEBIT_NOTE (contractor debit notes). Filled by the contractor feed. Never write from the app.';
comment on table public.in4_wo_debit_note_recoveries is
  'Mirror of IN4 ENGG_WO_PAYMENT_DEBIT_NOTE_RECOVERY — which bill recovered how much of which debit note. Never write from the app.';
