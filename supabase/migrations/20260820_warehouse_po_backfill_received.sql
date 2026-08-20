-- One-off correction of the 2026-08-15 bulk PO import. APPLIED 2026-08-20.
--
-- What was wrong. On 2026-08-15 all 1,223 tracker POs were inserted in a single
-- transaction carrying `ordered_qty` only, every one with status 'open'. IN4's
-- already-received quantity was never brought across, so getPoBalance computed
-- pending as `ordered − receipts at OUR gate`, and our gate had none. All 4,067
-- lines therefore advertised their FULL ordered quantity as still to come —
-- 1,415,280 units, of which 1,373,374 had in truth already been delivered
-- before this system existed. Working that list at the gate would have booked
-- over a million units in a second time, on top of the 78,375-unit opening
-- balance imported from V1, which is the real physical stock.
--
-- How the figures were derived. The tracker holds ordered/received at LINE
-- level, plus a `pos[]` array where each entry carries its own `qty`. Checked
-- across every line: the sum of `pos[].qty` equals the line's `orderedQty`
-- exactly, in all 4,390 cases. So the per-PO ordered split is authoritative
-- rather than inferred. 4,058 of those lines sit on exactly ONE PO, where the
-- received figure belongs wholly to that PO. The remaining 292 span two or more
-- POs and the tracker records no per-PO receipt, so received is apportioned
-- pro-rata by that authoritative ordered split and capped at it. Those 292
-- lines are 99.7% received in aggregate, so the apportionment error is small and
-- bounded; the cap means apportionment can never manufacture an over-receipt
-- (real over-delivery is a gate matter and has its own control report).
--
-- Result, verified after applying: total received 1,372,964 against the
-- tracker's own 1,373,374 — a 0.03% gap, all of it the cap. Status landed at
-- 1,117 fully_received / 79 partly_received / 27 open, and the gate's PO picker
-- went from offering 1,223 orders to 106. No line ended with received above
-- ordered. 10 lines could not be matched to the tracker at all and were left
-- exactly as they were rather than guessed at.
--
-- Both statements are guarded to `received_before_qty = 0`, so re-running only
-- ever FILLS BLANKS. This matters: received_before_qty is a frozen snapshot,
-- and recomputing it against a later weekly IN4 upload would subtract a
-- delivery that had since been recorded at the gate — the same double-count
-- running the other way.

with fan as (
  select upper(trim(po_ref->>'poNo')) as po_no,
         trim(regexp_replace(lower(l->>'material'), '[^a-z0-9]+', ' ', 'g')) as k,
         coalesce((po_ref->>'qty')::numeric, 0) as po_qty,
         coalesce((l->>'orderedQty')::numeric, 0) as line_ordered,
         coalesce((l->>'receivedQty')::numeric, 0) as line_received
  from procurement_tracker_state s,
       jsonb_array_elements(coalesce(s.state->'projects', '[]'::jsonb)) p,
       jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) l,
       jsonb_array_elements(coalesce(l->'pos', '[]'::jsonb)) po_ref
  where s.id = 'global'
    and coalesce(l->>'material', '') <> ''
    and coalesce(po_ref->>'draft', 'false') <> 'true'   -- a draft PO is not an order
), tl as (
  select po_no, k,
         sum(po_qty) as ordered,
         sum(least(po_qty, case when line_ordered > 0
                                then line_received * (po_qty / line_ordered)
                                else 0 end)) as received
  from fan group by 1, 2
)
update wh_po_lines pl
set ordered_qty = round(tl.ordered, 3),
    received_before_qty = round(tl.received, 3)
from wh_po po, wh_items i, tl
where pl.po_id = po.id
  and i.id = pl.item_id
  and tl.po_no = upper(trim(po.po_no))
  and tl.k = trim(regexp_replace(lower(coalesce(i.in4_name, i.name)), '[^a-z0-9]+', ' ', 'g'))
  and pl.received_before_qty = 0;   -- fill blanks only, never overwrite

-- Status from the corrected line figures. Mirrors derivedStatus() in
-- lib/warehouse/po-balance.ts; short_closed is a human decision and is left be.
update wh_po po
set status = case
      when p.pending <= 0 then 'fully_received'
      when p.received > 0 then 'partly_received'
      else 'open'
    end
from (
  select po_id,
         sum(greatest(ordered_qty - received_before_qty, 0)) as pending,
         sum(received_before_qty) as received
  from wh_po_lines
  group by po_id
) p
where p.po_id = po.id
  and po.status <> 'short_closed';
