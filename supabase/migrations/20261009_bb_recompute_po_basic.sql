-- bb_recompute_bill_money learns purchase orders.
--
-- Aksha, 9 Oct 2026: the goods receipt now renders in the Abstract Sheet
-- format and takes deductions at the Disc Head / CT Head desks, so the
-- recompute needs a basic value for a PO bill too. Before this it knew only
-- CT Hub's own lines and a work order's approved abstract.
--
-- PO basic value, at the order's rates before tax (what the supplier's
-- invoice prices the goods at):
--   • a supplier certificate already exists for this invoice number →
--     the sum of its pay lines' certified_amt;
--   • else every approved receipt line on the order that no certificate has
--     taken yet → received_qty × the PO line's net_rate.
create or replace function public.bb_recompute_bill_money(
  p_bill uuid, p_gst numeric, p_retention_pct numeric, p_retention_amt numeric, p_deductions jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_basic numeric; v_gst numeric; v_gross numeric; v_ret numeric; v_ded numeric := 0; v_net numeric;
  v_order text; v_billno text; v_type text; v_po_id integer;
  v_rows jsonb := '[]'::jsonb; d jsonb; v_amt numeric; v_kind text; v_mode text; v_val numeric;
begin
  select order_type, order_no, bill_no into v_type, v_order, v_billno from public.bb_bills where id = p_bill;

  -- 1. CT Hub's own measurement.
  select sum(this_amt) into v_basic from public.bb_bill_lines where bill_id = p_bill;

  -- 2. A work order's approved abstract for this bill number.
  if v_basic is null and v_type = 'WO' then
    select sum(a.executed_amt) into v_basic
      from public.in4_wo_abstract_items a
      join public.in4_work_orders w on w.wo_id = a.wo_id
     where w.display_no = v_order
       and lower(btrim(a.bill_no)) = lower(btrim(coalesce(v_billno, '')))
       and a.status = 'Approved';
  end if;

  -- 3. A purchase order: the certificate's lines, else the open receipt lines.
  if v_basic is null and v_type = 'PO' then
    select po_id into v_po_id from public.in4_purchase_orders where po_no = v_order limit 1;
    if v_po_id is not null then
      select sum(l.certified_amt) into v_basic
        from public.in4_supplier_pay_lines l
       where l.po_id = v_po_id
         and lower(btrim(coalesce(l.invoice_no, ''))) = lower(btrim(coalesce(v_billno, '')))
         and coalesce(v_billno, '') <> '';
      if v_basic is null then
        select sum(g.received_qty * i.net_rate) into v_basic
          from public.in4_grn_items g
          join public.in4_po_items i on i.po_id = g.po_id and i.material_id = g.material_id
         where g.po_id = v_po_id
           and g.status = 'Approved'
           and not exists (select 1 from public.in4_supplier_pay_lines l
                            where l.po_id = g.po_id and l.grn_id = g.grn_id);
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
    if v_kind not in ('advance','recovery','debit') then raise exception 'Unknown deduction kind %', v_kind; end if;
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

  update public.bb_bills set
    certified_amount = v_basic,
    -- The claim IS the gross — Aksha works GST-inclusive. On a supplier bill
    -- the invoice as entered may carry freight or other charges above this;
    -- the sheet names that difference rather than hiding it.
    claimed_amount   = v_gross,
    net_amount       = v_net,
    gst_pct          = p_gst,
    retention_pct    = p_retention_pct,
    retention_amt    = p_retention_amt,
    deductions       = v_rows,
    updated_at       = now()
  where id = p_bill;

  return jsonb_build_object('basic', v_basic, 'gst', v_gst, 'gross', v_gross,
                            'retention', v_ret, 'deductions', v_ded, 'net', v_net, 'rows', v_rows);
end $function$;

revoke all on function public.bb_recompute_bill_money(uuid, numeric, numeric, numeric, jsonb) from public;
