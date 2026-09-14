-- The Abstract maker: fill the sheet in CT Hub, not in IN4.
--
-- Aksha, 14 Sep 2026: "yes make the Abstract maker in CT Hub and also live
-- example as well … it should be in screenshot format."
--
-- The format is the concept mockup from the design phase — one row per BOQ
-- item, four column groups (Work Order · This bill · Cumulative · Balance),
-- and only ONE typed number per row: This Qty. Everything else computes:
--
--     This Amt   = This Qty × the ordered rate
--     Cum Qty    = measured before + This Qty
--     Bal Qty    = ordered − Cum Qty
--     Sub total → GST → Total → less Retention → NET PAYABLE
--
-- The lines seed from the work order's own BOQ, which is mirrored complete and
-- exact: on all eight example orders the BOQ sums to the ordered value to the
-- rupee. So the rate is never typed either — it is what was ordered, and a
-- rate somebody can retype is a rate that ends up wrong.
--
-- Until now the abstract was filled in IN4 and CT Hub could only read it back.

create table if not exists public.bb_bill_lines (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references public.bb_bills(id) on delete cascade,
  -- The IN4 BOQ item this line measures. Null for a line somebody added that
  -- the order does not carry — which happens, and is worth seeing rather than
  -- refusing.
  item_id       integer,
  sr            integer not null default 0,
  particular    text not null,
  uom           text,
  ordered_qty   numeric not null default 0,
  rate          numeric not null default 0,
  ordered_amt   numeric not null default 0,
  -- What was already measured on this item before this bill, snapshotted when
  -- the sheet is saved. A snapshot rather than a live sum because the sheet is
  -- evidence: it must read the same in a year as it did on the day.
  prior_qty     numeric not null default 0,
  prior_amt     numeric not null default 0,
  this_qty      numeric not null default 0,
  this_amt      numeric not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists bb_bill_lines_bill_idx on public.bb_bill_lines (bill_id, sr);

comment on table public.bb_bill_lines is
  'The abstract sheet of one bill — one row per BOQ item measured. Seeded from in4_wo_boq_items; only this_qty is typed.';

-- The rates the sheet was worked at, kept on the bill so it reproduces.
alter table public.bb_bills
  add column if not exists gst_pct numeric,
  add column if not exists retention_pct numeric;

alter table public.bb_bill_lines enable row level security;

drop policy if exists bb_bill_lines_select on public.bb_bill_lines;
create policy bb_bill_lines_select on public.bb_bill_lines for select to authenticated
using (exists (select 1 from public.role_permissions rp, public.profiles p
               where p.id = auth.uid() and rp.role = p.role
                 and rp.module_slug = 'bills-booking' and rp.can_view = true));

-- No insert/update/delete policy: like every other write in this module, the
-- sheet goes through a definer function that recomputes the totals. Letting a
-- client write the lines and the bill separately is how the two disagree.

/**
 * Save the abstract. Replaces the lines, recomputes the money, writes a trail.
 *
 * The totals are computed HERE from the quantities, never taken from the
 * caller. The whole point of the sheet is that the amount follows from the
 * measurement, and a total posted by a browser is not that.
 */
create or replace function public.bb_rpc_save_abstract(
  p_bill uuid, p_gst numeric, p_retention numeric, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid(); v_edit boolean; v_stage bb_stage;
  v_basic numeric := 0; v_gst numeric; v_gross numeric; v_ret numeric; v_net numeric;
  v_lines integer := 0;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role
      and rp.module_slug = 'bills-booking' and rp.can_edit = true) into v_edit;
  if not v_edit then raise exception 'You do not have permission to change bills'; end if;

  select current_stage into v_stage from public.bb_bills where id = p_bill;
  if not found then raise exception 'That bill does not exist'; end if;

  delete from public.bb_bill_lines where bill_id = p_bill;

  insert into public.bb_bill_lines(
    bill_id, item_id, sr, particular, uom, ordered_qty, rate, ordered_amt,
    prior_qty, prior_amt, this_qty, this_amt)
  select
    p_bill,
    nullif(l->>'item_id','')::integer,
    coalesce((l->>'sr')::integer, 0),
    coalesce(nullif(btrim(l->>'particular'),''), 'Item'),
    nullif(l->>'uom',''),
    coalesce((l->>'ordered_qty')::numeric, 0),
    coalesce((l->>'rate')::numeric, 0),
    coalesce((l->>'ordered_amt')::numeric, 0),
    coalesce((l->>'prior_qty')::numeric, 0),
    coalesce((l->>'prior_amt')::numeric, 0),
    coalesce((l->>'this_qty')::numeric, 0),
    -- Amount from quantity × rate, server side. Not from the payload.
    round(coalesce((l->>'this_qty')::numeric, 0) * coalesce((l->>'rate')::numeric, 0), 2)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  where coalesce((l->>'this_qty')::numeric, 0) <> 0;

  get diagnostics v_lines = row_count;

  select coalesce(sum(this_amt), 0) into v_basic from public.bb_bill_lines where bill_id = p_bill;

  v_gst   := round(v_basic * coalesce(p_gst, 0) / 100, 2);
  v_gross := v_basic + v_gst;
  v_ret   := round(v_basic * coalesce(p_retention, 0) / 100, 2);
  v_net   := v_gross - v_ret;

  update public.bb_bills set
    certified_amount = v_basic,
    -- The claim IS the gross, because that is how Aksha works — final
    -- GST-inclusive amounts, never basic.
    claimed_amount   = v_gross,
    net_amount       = v_net,
    gst_pct          = p_gst,
    retention_pct    = p_retention
  where id = p_bill;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, v_stage, v_stage, 'abstract',
          'Abstract saved — ' || v_lines || ' ' || case when v_lines = 1 then 'item' else 'items' end
          || ' measured, net payable ' || to_char(v_net, 'FM99,99,99,999'),
          v_net, v_actor);

  return jsonb_build_object(
    'status','ok', 'lines', v_lines,
    'basic', v_basic, 'gst', v_gst, 'gross', v_gross, 'retention', v_ret, 'net', v_net);
end $function$;

grant execute on function public.bb_rpc_save_abstract(uuid, numeric, numeric, jsonb) to authenticated;
