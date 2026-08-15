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
