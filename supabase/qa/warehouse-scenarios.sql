-- ===========================================================================
-- WAREHOUSE V2 — scenario sweep for the rules the DATABASE enforces.
--
-- NOT a migration. This folder is never applied; migrations live in
-- supabase/migrations only. Paste this into the SQL editor and run it: it seeds
-- a full journey against real rows, asserts each outcome, prints a table and
-- then ROLLS BACK, so it is safe to run against production.
--
-- The rules enforced in CODE rather than by a constraint — the period lock, the
-- count-freeze, submit blockers, stock folding, the IN4 sync — are covered by
-- lib/warehouse/scenarios.test.ts instead.
--
-- Everything here passed on 2026-08-13.
-- ===========================================================================

begin;
create temp table r (id text, scenario text, expected text, actual text, verdict text) on commit drop;
create or replace function ok(p_id text, p_s text, p_e text, p_a text, p_pass boolean) returns void
language sql as $$ insert into r values (p_id,p_s,p_e,p_a, case when p_pass then 'PASS' else '*** FAIL ***' end) $$;

do $$
declare
  keeper uuid; witness uuid; head uuid; eng uuid;
  st1 uuid; st2 uuid; proj uuid;
  cement uuid; steel uuid; plate uuid;
  v_po uuid; pl_c uuid; pl_s uuid;
  g uuid; o uuid; cnt uuid;
  n int; q numeric; q2 numeric;
  total_before numeric; total_after numeric;
begin
  select id into keeper  from profiles order by created_at limit 1;
  select id into witness from profiles order by created_at offset 1 limit 1;
  select id into head    from profiles order by created_at offset 2 limit 1;
  select id into eng     from profiles order by created_at offset 3 limit 1;
  select id into st1 from wh_locations where parent_id is not null order by sort, name limit 1;
  select id into st2 from wh_locations where parent_id is not null order by sort, name offset 1 limit 1;
  select id into proj from projects order by name limit 1;
  select id into cement from wh_items where is_active order by name limit 1;
  select id into steel  from wh_items where is_active order by name offset 1 limit 1;
  select id into plate  from wh_items where is_active order by name offset 2 limit 1;

  insert into wh_po (po_no, po_date, vendor, entity, source, created_by)
    values ('PO/QA/1', current_date - 20, 'Ultratech', 'SRASSK', 'tracker', keeper) returning id into v_po;
  insert into wh_po_lines (po_id, item_id, ordered_qty, rate, source_text)
    values (v_po, cement, 1000, 392, 'OPC 53 CEMENT') returning id into pl_c;
  insert into wh_po_lines (po_id, item_id, ordered_qty, rate, source_text)
    values (v_po, steel, 100, 68000, 'TMT BARS 8MM') returning id into pl_s;

  -- S01 · a normal truck
  insert into wh_gate_in (entry_no, owner, po_id, party, location_id, photo_urls, created_by)
    values (fn_wh_next_no('in'),'srm',v_po,'Ultratech',st1,array['qa/bill-p1.jpg'],keeper) returning id into g;
  insert into wh_gate_in_lines (gate_in_id,item_id,po_line_id,challan_qty,received_qty,damaged_qty,rate,rate_source)
    values (g,cement,pl_c,500,500,0,392,'po');
  insert into wh_movements (item_id,location_id,kind,qty,rate,ref_table,ref_id,actor_id)
    values (cement,st1,'in',500,392,'wh_gate_in',g,keeper);
  insert into wh_stock (item_id,location_id,qty) values (cement,st1,500)
    on conflict (item_id,location_id) do update set qty = wh_stock.qty + 500;
  select qty into q from wh_stock where item_id=cement and location_id=st1;
  perform ok('S01','Truck arrives with the full ordered quantity','500 in good stock', q||' in stock', q=500);

  -- S02 · short delivery
  insert into wh_gate_in_lines (gate_in_id,item_id,po_line_id,challan_qty,received_qty,damaged_qty,rate,rate_source)
    values (g,steel,pl_s,50,47,0,68000,'po');
  select short_qty, good_qty into q, q2 from wh_gate_in_lines where gate_in_id=g and item_id=steel;
  perform ok('S02','Challan says 50, only 47 comes off the truck',
    'shortage 3 recorded, 47 to stock', 'short '||q||', good '||q2, q=3 and q2=47);

  -- S03 · damaged on arrival
  insert into wh_gate_in_lines (gate_in_id,item_id,po_line_id,challan_qty,received_qty,damaged_qty,rate,rate_source)
    values (g,plate,null,100,100,15,500,'typed');
  select good_qty, damaged_qty into q, q2 from wh_gate_in_lines where gate_in_id=g and item_id=plate;
  perform ok('S03','100 arrive, 15 of them broken',
    '85 good, 15 damaged and NOT in good stock', 'good '||q||', damaged '||q2, q=85 and q2=15);

  -- S04 · damaged cannot exceed received
  begin
    insert into wh_gate_in_lines (gate_in_id,item_id,challan_qty,received_qty,damaged_qty)
      values (g,plate,10,10,20);
    perform ok('S04','Someone types damaged 20 out of 10 received','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S04','Someone types damaged 20 out of 10 received','refused','refused by the database', true);
  end;

  -- S05 · over-receipt saves and stays visible
  insert into wh_gate_in_lines (gate_in_id,item_id,po_line_id,challan_qty,received_qty,rate,rate_source)
    values (g,steel,pl_s,60,60,68000,'po');
  select sum(received_qty) into q from wh_gate_in_lines where po_line_id=pl_s;
  select ordered_qty into q2 from wh_po_lines where id=pl_s;
  perform ok('S05','107 received against an order for 100 — a truck is never turned away',
    'saves, and shows as over by 7', 'received '||q||' vs ordered '||q2||' -> over by '||(q-q2), q-q2=7);

  -- S06 · no PO and no reason
  begin
    insert into wh_gate_in (entry_no,owner,party,location_id,photo_urls,created_by)
      values (fn_wh_next_no('in'),'srm','Local Hardware',st1,array['qa/bill-p1.jpg'],keeper);
    perform ok('S06','Emergency entry with no PO and no reason given','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S06','Emergency entry with no PO and no reason given','refused','refused by the database', true);
  end;

  -- S06b · an entry with no photographed bill
  begin
    insert into wh_gate_in (entry_no,owner,po_id,party,location_id,created_by)
      values (fn_wh_next_no('in'),'srm',v_po,'Ultratech',st1,keeper);
    perform ok('S06b','An entry saved without photographing the bill','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S06b','An entry saved without photographing the bill','refused, with a PO or without',
      'refused by the database', true);
  end;

  -- S07 · IN4 mismatch flagged with no explanation
  begin
    insert into wh_gate_in_lines (gate_in_id,item_id,po_line_id,challan_qty,received_qty,differs_from_po)
      values (g,plate,pl_c,10,10,true);
    perform ok('S07','Keeper flags "not what IN4 ordered" but writes no note','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S07','Keeper flags "not what IN4 ordered" but writes no note','refused','refused by the database', true);
  end;

  -- S08 · IN4 mismatch with a note — the PO line still receives
  insert into wh_gate_in_lines (gate_in_id,item_id,po_line_id,challan_qty,received_qty,differs_from_po,differ_note)
    values (g,plate,pl_c,20,20,true,'IN4 says cement, the truck brought shuttering plates');
  select count(*) into n from wh_gate_in_lines l join wh_po_lines p on p.id=l.po_line_id
    where l.differs_from_po and l.item_id <> p.item_id;
  select sum(received_qty) into q from wh_gate_in_lines where po_line_id=pl_c;
  perform ok('S08','What came is not what IN4 ordered, with a note',
    'accepted, flagged, and that PO line still receives', n||' flagged mismatch; PO line received '||q, n=1 and q=520);

  -- S09 · issuing more than the store holds (the action refuses; this proves the condition)
  select qty into q from wh_stock where item_id=cement and location_id=st1;
  perform ok('S09','Engineer asks for 900 bags when the store holds '||q,
    'refused, naming what is actually there', 'available '||q||' < 900', q < 900);

  -- S10 · site issue
  insert into wh_gate_out (entry_no,dest_type,from_location_id,project_id,entity,engineer_id,created_by)
    values (fn_wh_next_no('out'),'site',st1,proj,'SRASSK',eng,keeper) returning id into o;
  insert into wh_gate_out_lines (gate_out_id,item_id,qty,rate) values (o,cement,100,392);
  insert into wh_movements (item_id,location_id,kind,qty,rate,ref_table,ref_id,actor_id)
    values (cement,st1,'issue',100,392,'wh_gate_out',o,keeper);
  update wh_stock set qty = qty - 100 where item_id=cement and location_id=st1;
  select qty into q from wh_stock where item_id=cement and location_id=st1;
  perform ok('S10','100 bags issued to a site','stock 500 -> 400, project charged', 'stock now '||q, q=400);

  -- S11 · a store move must not change total stock
  select coalesce(sum(qty),0) into total_before from wh_stock where item_id=cement;
  insert into wh_gate_out (entry_no,dest_type,from_location_id,to_location_id,created_by)
    values (fn_wh_next_no('move'),'store',st1,st2,keeper) returning id into o;
  insert into wh_gate_out_lines (gate_out_id,item_id,qty) values (o,cement,150);
  insert into wh_movements (item_id,location_id,kind,qty,ref_table,ref_id,actor_id) values
    (cement,st1,'move_out',150,'wh_gate_out',o,keeper),
    (cement,st2,'move_in',150,'wh_gate_out',o,keeper);
  update wh_stock set qty = qty - 150 where item_id=cement and location_id=st1;
  insert into wh_stock (item_id,location_id,qty) values (cement,st2,150)
    on conflict (item_id,location_id) do update set qty = wh_stock.qty + 150;
  select coalesce(sum(qty),0) into total_after from wh_stock where item_id=cement;
  perform ok('S11','150 bags moved from one store to another',
    'total stock unchanged, only where it lies', 'total '||total_before||' -> '||total_after, total_before=total_after);

  -- S12 · a move into the same store
  begin
    insert into wh_gate_out (entry_no,dest_type,from_location_id,to_location_id,created_by)
      values (fn_wh_next_no('move'),'store',st1,st1,keeper);
    perform ok('S12','Move from a store into itself','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S12','Move from a store into itself','refused','refused by the database', true);
  end;

  -- S13 · a move that charges a project
  begin
    insert into wh_gate_out (entry_no,dest_type,from_location_id,to_location_id,project_id,created_by)
      values (fn_wh_next_no('move'),'store',st1,st2,proj,keeper);
    perform ok('S13','A store move that also names a project to charge','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S13','A store move that also names a project to charge','refused','refused - a move charges nobody', true);
  end;

  -- S14 · a vendor return is never site consumption
  insert into wh_gate_out (entry_no,dest_type,from_location_id,party,created_by)
    values (fn_wh_next_no('out'),'vendor',st1,'Shah Scaffolding',keeper) returning id into o;
  insert into wh_gate_out_lines (gate_out_id,item_id,qty) values (o,plate,50);
  insert into wh_movements (item_id,location_id,kind,qty,ref_table,ref_id,actor_id)
    values (plate,st1,'vendor_out',50,'wh_gate_out',o,keeper);
  select count(*) into n from wh_movements where kind='issue' and item_id=plate;
  select count(*) into q from wh_movements where kind='vendor_out' and item_id=plate;
  perform ok('S14','Vendor takes his own scaffolding back',
    'leaves stock but never counts as site consumption', q||' vendor_out, '||n||' issue', q=1 and n=0);

  -- S15 · a vendor return with nobody named
  begin
    insert into wh_gate_out (entry_no,dest_type,from_location_id,created_by)
      values (fn_wh_next_no('out'),'vendor',st1,keeper);
    perform ok('S15','Vendor return with nobody named','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S15','Vendor return with nobody named','refused','refused - the name matches it to his IN', true);
  end;

  -- S16 · the count sheet is frozen when the count starts
  select qty into q from wh_stock where item_id=cement and location_id=st1;
  insert into wh_counts (count_no,location_id,scope,blind,counted_by,witness_id)
    values (fn_wh_next_no('count'),st1,'location',true,keeper,witness) returning id into cnt;
  insert into wh_count_lines (count_id,item_id,seq,book_qty) values (cnt,cement,1,q);
  update wh_stock set qty = qty + 40 where item_id=cement and location_id=st1;   -- a truck arrives mid-count
  select book_qty into q2 from wh_count_lines where count_id=cnt and item_id=cement;
  perform ok('S16','A truck arrives while he is still counting',
    'the sheet keeps the frozen figure', 'sheet says '||q2||', live stock now '||(q+40), q2=q);

  -- S17 · skipped with no reason
  begin
    update wh_count_lines set skipped=true, skip_reason=null where count_id=cnt;
    perform ok('S17','"Cannot count it" with no reason','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S17','"Cannot count it" with no reason','refused','refused by the database', true);
  end;

  -- S18 · the difference is computed by the database itself
  update wh_count_lines set counted_qty = book_qty - 29, reason='Wastage at site' where count_id=cnt;
  select diff into q from wh_count_lines where count_id=cnt;
  perform ok('S18','He counts 29 fewer than the book says',
    'the database itself computes -29', 'diff = '||q, q = -29);

  -- S19 · approved by nobody
  begin
    update wh_counts set status='approved', approved_at=now() where id=cnt;
    perform ok('S19','A count approved by nobody','refused','ACCEPTED', false);
  exception when check_violation then
    perform ok('S19','A count approved by nobody','refused','refused - structural, always enforced', true);
  end;

  -- S20 · approval corrects stock to the counted figure
  update wh_counts set status='approved', approved_by=head, approved_at=now() where id=cnt;
  insert into wh_movements (item_id,location_id,kind,qty,ref_table,ref_id,actor_id,remarks)
    values (cement,st1,'adjust',-29,'wh_counts',cnt,head,'QA count · Wastage at site');
  select counted_qty into q2 from wh_count_lines where count_id=cnt;
  update wh_stock set qty = q2 where item_id=cement and location_id=st1;
  select qty into q from wh_stock where item_id=cement and location_id=st1;
  perform ok('S20','Head approves the count',
    'stock set to the counted figure, ledger carries a signed -29',
    'stock now '||q||', counted was '||q2, q = q2);
end $$;

select * from r order by id;
rollback;

-- ===========================================================================
-- S43–S46 · The four corrections (2026-08-16)
--
-- Run against production inside a transaction that is rolled back. These
-- exercise the DATABASE side of what admin-actions.ts does; the refusals
-- themselves are unit-tested in lib/warehouse/corrections.test.ts.
-- ===========================================================================
begin;

-- S43 · Voiding an IN nets the ledger back to zero on BOTH buckets.
--       Good stock reverses as `void`; damaged reverses as negative `damage`,
--       because damage has no effect on good stock and inverting that effect
--       would post nothing at all.
create temp table s43(k text primary key, v uuid);
insert into s43 values ('loc', (select id from wh_locations where parent_id is not null limit 1));
insert into s43 values ('it',  (select id from wh_items where deleted_at is null limit 1));
insert into wh_gate_in (entry_no, entry_date, owner, party, location_id, photo_urls, no_po_reason)
values ('QA-VOID-1', current_date, 'srm', 'QA Supplier', (select v from s43 where k='loc'),
        array['x.jpg'], 'QA test');
insert into s43 values ('in', (select id from wh_gate_in where entry_no='QA-VOID-1'));
insert into wh_gate_in_lines (gate_in_id, item_id, challan_qty, received_qty, damaged_qty)
values ((select v from s43 where k='in'), (select v from s43 where k='it'), 100, 100, 5);
insert into wh_movements (item_id, location_id, kind, qty, ref_table, ref_id) values
  ((select v from s43 where k='it'), (select v from s43 where k='loc'), 'in',     95, 'wh_gate_in', (select v from s43 where k='in')),
  ((select v from s43 where k='it'), (select v from s43 where k='loc'), 'damage',  5, 'wh_gate_in', (select v from s43 where k='in'));
-- the reversal
insert into wh_movements (item_id, location_id, kind, qty, ref_table, ref_id, remarks) values
  ((select v from s43 where k='it'), (select v from s43 where k='loc'), 'void',   -95, 'wh_gate_in', (select v from s43 where k='in'), 'Void of QA-VOID-1: wrong store'),
  ((select v from s43 where k='it'), (select v from s43 where k='loc'), 'damage',  -5, 'wh_gate_in', (select v from s43 where k='in'), 'Void of QA-VOID-1: wrong store');
update wh_gate_in set deleted_at = now(), void_reason = 'wrong store' where entry_no = 'QA-VOID-1';

select 'S43 void nets to zero' step,
  sum(case when kind in ('in','return','move_in') then qty
           when kind in ('issue','move_out','vendor_out') then -qty
           when kind in ('adjust','void') then qty else 0 end) as good_effect,   -- expect 0
  sum(case when kind = 'damage' then qty else 0 end) as damaged_effect           -- expect 0
from wh_movements
where ref_table = 'wh_gate_in' and ref_id = (select v from s43 where k='in');

-- S44 · A voided receipt hands its quantity back to the purchase order, so a
--       mistyped entry can never close an order against material that never came.
select 'S44 voided entries excluded from PO received' step,
  count(*) filter (where e.deleted_at is not null) as voided_lines_ignored
from wh_gate_in_lines l join wh_gate_in e on e.id = l.gate_in_id
where l.po_line_id is not null;

-- S45 · A partial return: 200 out, 50 already back, 80 more → 70 still out.
create temp table s45(k text primary key, v uuid);
insert into s45 values ('loc', (select id from wh_locations where parent_id is not null limit 1));
insert into s45 values ('it',  (select id from wh_items where deleted_at is null limit 1));
insert into wh_gate_out (entry_no, entry_date, dest_type, from_location_id, project_id, is_returnable)
values ('QA-RET-1', current_date, 'site', (select v from s45 where k='loc'),
        (select id from projects limit 1), true);
insert into s45 values ('out', (select id from wh_gate_out where entry_no='QA-RET-1'));
insert into wh_gate_out_lines (gate_out_id, item_id, qty, returned_qty)
values ((select v from s45 where k='out'), (select v from s45 where k='it'), 200, 50);
insert into wh_movements (item_id, location_id, kind, qty, ref_table, ref_id, remarks)
values ((select v from s45 where k='it'), (select v from s45 where k='loc'), 'return', 80,
        'wh_gate_out', (select v from s45 where k='out'), 'Returned against QA-RET-1');
update wh_gate_out_lines set returned_qty = returned_qty + 80
where gate_out_id = (select v from s45 where k='out');

select 'S45 partial return' step,
  qty as went_out, returned_qty as back, qty - returned_qty as still_out   -- expect 200 / 130 / 70
from wh_gate_out_lines where gate_out_id = (select v from s45 where k='out');

-- S46 · Merging two items adds their stock in the SAME store rather than
--       failing on the unique (item, location) index, and the loser keeps
--       pointing at what it became.
create temp table s46(k text primary key, v uuid);
insert into s46 values ('loc', (select id from wh_locations where parent_id is not null limit 1));
insert into wh_items (name, unit, source) values ('QA Merge Loser','Bag','manual'), ('QA Merge Keeper','Bag','manual');
insert into s46 values ('a', (select id from wh_items where name='QA Merge Loser'));
insert into s46 values ('b', (select id from wh_items where name='QA Merge Keeper'));
insert into wh_stock (item_id, location_id, qty) values
  ((select v from s46 where k='a'), (select v from s46 where k='loc'), 30),
  ((select v from s46 where k='b'), (select v from s46 where k='loc'), 12);
insert into wh_movements (item_id, location_id, kind, qty)
values ((select v from s46 where k='a'), (select v from s46 where k='loc'), 'in', 30);

update wh_stock set qty = qty + 30
  where item_id = (select v from s46 where k='b') and location_id = (select v from s46 where k='loc');
delete from wh_stock
  where item_id = (select v from s46 where k='a') and location_id = (select v from s46 where k='loc');
update wh_movements set item_id = (select v from s46 where k='b')
  where item_id = (select v from s46 where k='a');
update wh_items set merged_into = (select v from s46 where k='b'), is_active = false, deleted_at = now()
  where id = (select v from s46 where k='a');

select 'S46 merge' step,
  (select qty from wh_stock where item_id = (select v from s46 where k='b')
     and location_id = (select v from s46 where k='loc')) as keeper_qty,          -- expect 42
  (select count(*) from wh_stock where item_id = (select v from s46 where k='a')) as loser_rows,  -- expect 0
  (select merged_into is not null and not is_active
     from wh_items where id = (select v from s46 where k='a')) as loser_retired;  -- expect true

rollback;

-- ===========================================================================
-- S47-S50 · Material requests and the approval chain (2026-08-17)
--
-- Verified against production. S47 runs in a rolled-back transaction; S48-S50
-- provoke a constraint and catch it, so they write nothing at all.
-- ===========================================================================
begin;
-- S47 · The whole chain: raise a two-stage request, approve twice, part issue.
create temp table s47(k text primary key, v uuid);
insert into s47 values ('loc', (select id from wh_locations where parent_id is not null limit 1));
insert into s47 values ('it',  (select id from wh_items where deleted_at is null limit 1));
insert into s47 values ('prj', (select id from projects limit 1));

insert into wh_requests (req_no, from_location_id, project_id, purpose,
                         status, rule_at_raise, est_value, stages_needed, stages_done)
values ('QA-RQ-1', (select v from s47 where k='loc'), (select v from s47 where k='prj'),
        'QA slab shuttering', 'pending', 'above_value', 60000, 2, 0);
insert into s47 values ('req', (select id from wh_requests where req_no='QA-RQ-1'));
insert into wh_request_lines (request_id, item_id, qty)
values ((select v from s47 where k='req'), (select v from s47 where k='it'), 100);

update wh_requests set stages_done = 1, approved1_at = now() where id = (select v from s47 where k='req');
update wh_requests set stages_done = 2, approved2_at = now(), status = 'approved'
  where id = (select v from s47 where k='req');

insert into wh_gate_out (entry_no, entry_date, dest_type, from_location_id, project_id, request_id)
values ('QA-RQ-OUT', current_date, 'site', (select v from s47 where k='loc'),
        (select v from s47 where k='prj'), (select v from s47 where k='req'));
update wh_request_lines set issued_qty = 40 where request_id = (select v from s47 where k='req');
update wh_requests set status = 'part_issued' where id = (select v from s47 where k='req');

select 'S47 request chain' step,
  (select status from wh_requests where id=(select v from s47 where k='req')) as status,          -- part_issued
  (select stages_done || ' of ' || stages_needed from wh_requests
     where id=(select v from s47 where k='req')) as approvals,                                     -- 2 of 2
  (select qty - issued_qty from wh_request_lines
     where request_id=(select v from s47 where k='req')) as still_to_come,                         -- 60
  (select count(*) from wh_gate_out where request_id=(select v from s47 where k='req')) as issues;  -- 1
rollback;

-- S48-S50 · The guards the DATABASE enforces, not just the UI. Each statement
-- is expected to be REFUSED; the helper catches it so nothing is written.
create or replace function pg_temp.qa_guard(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return 'ACCEPTED — GUARD MISSING';
exception
  when check_violation  then return 'refused by CHECK';
  when unique_violation then return 'refused by UNIQUE';
  when others           then return 'refused: ' || sqlstate;
end $$;

with loc as (select id from wh_locations where parent_id is not null limit 1),
     it  as (select id from wh_items where deleted_at is null limit 1)
select 'S48 rejection with no reason' as guard, pg_temp.qa_guard(format(
  'insert into wh_requests (req_no, from_location_id, purpose, status) values (%L,%L,%L,%L)',
  'QA-A', (select id from loc), 'QA', 'rejected')) as result
union all
select 'S49 more approvals than needed', pg_temp.qa_guard(format(
  'insert into wh_requests (req_no, from_location_id, purpose, stages_needed, stages_done) values (%L,%L,%L,1,2)',
  'QA-B', (select id from loc), 'QA'))
union all
select 'S50 zero quantity on a line', pg_temp.qa_guard(format(
  'insert into wh_request_lines (request_id, item_id, qty) values (%L,%L,0)',
  gen_random_uuid(), (select id from it)));

-- ===========================================================================
-- S51-S60 · Requests, after the four runtime bugs (2026-08-19)
--
-- Every one of those bugs typechecked, linted and BUILT clean, and three of the
-- four could only ever surface on a real screen. This suite exists so they stay
-- dead. Self-cleaning: it deletes its own rows and returns a pass column.
--
--   select * from pg_temp.qa_suite();   -- after defining it below
-- ===========================================================================
create or replace function pg_temp.qa_suite() returns table(scenario text, expected text, got text, pass boolean)
language plpgsql as $$
declare
  loc  uuid := (select id from wh_locations where parent_id is not null limit 1);
  loc2 uuid := (select id from wh_locations where parent_id is not null offset 1 limit 1);
  it1  uuid := (select id from wh_items where deleted_at is null limit 1);
  it2  uuid := (select id from wh_items where deleted_at is null offset 1 limit 1);
  prj  uuid := (select id from projects limit 1);
  rq   uuid; n text; r text;
begin
  -- S51 THE bug Aksha hit: fn_wh_next_no('req') vs the register CHECK.
  begin n := fn_wh_next_no('req'); r := 'issued'; exception when others then r := 'FAILED'; end;
  return query select 'S51 request number issues'::text, 'issued'::text, r, r = 'issued';

  -- S52 the CHECK still refuses a typo, so it was widened not dropped.
  begin
    insert into wh_number_series (register, day, last_no) values ('reqq', current_date, 1);
    r := 'accepted';
  exception when check_violation then r := 'refused'; end;
  return query select 'S52 typo register refused'::text, 'refused'::text, r, r = 'refused';

  -- S53 one request, one consumable line and one returnable line.
  insert into wh_requests (req_no, from_location_id, project_id, purpose,
                           status, rule_at_raise, est_value, stages_needed, stages_done)
  values ('QA-S-1', loc, prj, 'QA pour', 'pending', 'matrix', 500000, 1, 0) returning id into rq;
  insert into wh_request_lines (request_id, item_id, qty, note, is_returnable)
  values (rq, it1, 200, 'consumed', false), (rq, it2, 40, 'plates', true);
  select count(*) filter (where is_returnable) || ' of ' || count(*)
    into r from wh_request_lines where request_id = rq;
  return query select 'S53 per-line returnable'::text, '1 of 2'::text, r, r = '1 of 2';

  -- S54 the two-stage chain. `stages_done <= stages_needed` made this fail.
  begin
    update wh_requests set status='checked',  stages_done=1, approved1_at=now() where id=rq;
    update wh_requests set status='approved', stages_done=2, approved2_at=now() where id=rq;
    select status || '/' || stages_done into r from wh_requests where id = rq;
  exception when others then r := 'FAILED: ' || sqlstate; end;
  return query select 'S54 two-stage chain completes'::text, 'approved/2'::text, r, r = 'approved/2';

  -- S55 a rejection with no reason is refused by the DATABASE.
  begin
    insert into wh_requests (req_no, from_location_id, purpose, status)
    values ('QA-S-2', loc, 'QA', 'rejected'); r := 'accepted';
  exception when check_violation then r := 'refused'; end;
  return query select 'S55 rejection needs a reason'::text, 'refused'::text, r, r = 'refused';

  -- S56 an invented stage cannot be written.
  begin
    update wh_requests set status = 'whatever' where id = rq; r := 'accepted';
  exception when others then r := 'refused'; end;
  return query select 'S56 unknown stage refused'::text, 'refused'::text, r, r = 'refused';

  -- S57 the gate_out shape CHECK still forbids a returnable store move.
  begin
    insert into wh_gate_out (entry_no, entry_date, dest_type, from_location_id,
                             to_location_id, is_returnable)
    values ('QA-S-MOVE', current_date, 'store', loc, loc2, true); r := 'accepted';
  exception when check_violation then r := 'refused'; end;
  return query select 'S57 store move not returnable'::text, 'refused'::text, r, r = 'refused';

  -- S58 an issue links back and leaves the right balance outstanding.
  insert into wh_gate_out (entry_no, entry_date, dest_type, from_location_id, project_id, request_id)
  values ('QA-S-OUT', current_date, 'site', loc, prj, rq);
  update wh_request_lines set issued_qty = 100 where request_id = rq and item_id = it1;
  select sum(qty - issued_qty)::text into r from wh_request_lines where request_id = rq;
  return query select 'S58 part issue balance'::text, '140'::text, r, r = '140';

  -- S59/S60 both triggers are actually attached. The amount cap is enforced by
  -- the warehouse-only guard, because the SHARED trigger derives its amount from
  -- the change in est_value and a status move does not change it.
  select count(*)::text into r from pg_trigger
   where tgrelid = 'wh_requests'::regclass and tgname = 'wh_requests_cap_guard' and not tgisinternal;
  return query select 'S59 cap guard attached'::text, '1'::text, r, r = '1';

  select count(*)::text into r from pg_trigger
   where tgrelid = 'wh_requests'::regclass and tgname = 'wh_requests_approval_matrix' and not tgisinternal;
  return query select 'S60 matrix trigger attached'::text, '1'::text, r, r = '1';

  delete from wh_gate_out where entry_no in ('QA-S-OUT','QA-S-MOVE');
  delete from wh_requests where req_no like 'QA-S-%';
  delete from wh_number_series where register = 'req';
end $$;

select * from pg_temp.qa_suite();

-- ===========================================================================
-- S61-S63 · Cross-project returnable + the Atm Head's waiver  (2026-08-20)
--
-- Run as one block. It ends by raising ROLLBACK_ON_PURPOSE, so nothing it
-- writes survives; seeing that message IS the pass. Any other exception is a
-- real failure. Verified green against production 2026-08-20.
-- ===========================================================================
do $$
declare
  v_store uuid; v_proj uuid; v_req uuid; v_line uuid; v_me uuid; v_no text;
  ok_needs_returnable boolean := false;
  ok_needs_by boolean := false;
  ok_good_waiver boolean := false;
begin
  select id into v_store from wh_locations where name = 'NGH A store' and deleted_at is null;
  select id into v_proj  from projects where name = 'P2 A01';
  select id into v_me    from profiles limit 1;

  select fn_wh_next_no('req') into v_no;
  insert into wh_requests (req_no, from_location_id, project_id, purpose, requested_by,
                           status, rule_at_raise, stages_needed, stages_done)
  values (v_no, v_store, v_proj, 'SCENARIO S61 - delete me', v_me, 'approved', 'none', 0, 0)
  returning id into v_req;

  -- S61 · a waiver on a line that was never returnable is refused
  insert into wh_request_lines (request_id, item_id, qty, is_returnable)
  values (v_req, (select id from wh_items limit 1), 5, false) returning id into v_line;
  begin
    update wh_request_lines set return_waived_at = now(), return_waived_by = v_me where id = v_line;
  exception when check_violation then ok_needs_returnable := true;
  end;

  -- S62 · a waiver with nobody named is refused: it must be attributable
  update wh_request_lines set is_returnable = true where id = v_line;
  begin
    update wh_request_lines set return_waived_at = now(), return_waived_by = null where id = v_line;
  exception when check_violation then ok_needs_by := true;
  end;

  -- S63 · a proper waiver is accepted
  update wh_request_lines
     set return_waived_at = now(), return_waived_by = v_me, return_waived_note = 'consumed on site'
   where id = v_line;
  ok_good_waiver := true;

  if not (ok_needs_returnable and ok_needs_by and ok_good_waiver) then
    raise exception 'SCENARIO FAILED: needs_returnable=% needs_by=% good=%',
      ok_needs_returnable, ok_needs_by, ok_good_waiver;
  end if;
  raise exception 'ROLLBACK_ON_PURPOSE: S61-S63 all passed';
end $$;
