-- Atomically replace the Excel behind a RETURNED working sheet with a revised
-- one. Strictly scoped to the single p_ws_id: it only deletes/inserts THAT
-- sheet's cc_excel_rows and updates THAT sheet's own columns. It never touches
-- sibling versions (each has its own working_sheet_id) or any revision/chain
-- structure (which lives on a computed view, not this table). Being one
-- plpgsql function, the whole swap is a single transaction — all-or-nothing,
-- so a returned sheet can never be left half-updated / corrupted.
create or replace function public.cc_replace_ws_excel(
  p_ws_id         uuid,
  p_source_url    text,
  p_source_name   text,
  p_summary_total numeric,
  p_total         numeric,
  p_rows          jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ws  record;
begin
  select id, status, engineer_id, archived_at, summary_notes
    into v_ws
  from cc_working_sheets
  where id = p_ws_id
  for update;   -- lock this one sheet for the swap

  if v_ws.id is null then
    raise exception 'Working sheet not found';
  end if;
  if v_uid is null or v_ws.engineer_id is distinct from v_uid then
    raise exception 'Only the engineer who raised this sheet can replace its Excel';
  end if;
  if v_ws.status <> 'returned' then
    raise exception 'Only a returned sheet can have its Excel replaced (current: %)', v_ws.status;
  end if;
  if v_ws.archived_at is not null then
    raise exception 'This sheet is archived';
  end if;
  if coalesce(v_ws.summary_notes, '') like '[IB%' then
    raise exception 'Estimate baseline sheets are changed through the revision workflow, not here';
  end if;

  -- Replace ONLY this sheet's rows.
  delete from cc_excel_rows where working_sheet_id = p_ws_id;

  insert into cc_excel_rows (
    working_sheet_id, row_no, raw_label, description, unit, qty, rate, amount,
    formula_in_amount, rate_breakdown, amount_breakdown, ai_meta,
    source_sheet, source_cell, qty_formula, qty_basis, qty_note
  )
  select p_ws_id, r.row_no, r.raw_label, r.description, r.unit, r.qty, r.rate, r.amount,
    r.formula_in_amount, r.rate_breakdown, r.amount_breakdown, r.ai_meta,
    r.source_sheet, r.source_cell, r.qty_formula, r.qty_basis, r.qty_note
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    row_no int, raw_label text, description text, unit text,
    qty numeric, rate numeric, amount numeric, formula_in_amount text,
    rate_breakdown jsonb, amount_breakdown jsonb, ai_meta jsonb,
    source_sheet text, source_cell text, qty_formula text, qty_basis text, qty_note text
  );

  update cc_working_sheets
  set source_excel_url = p_source_url,
      source_excel_name = p_source_name,
      summary_total   = p_summary_total,
      total_amount    = p_total,
      ai_parse_meta   = null,
      flag_summary    = null,
      last_checked_at = null
  where id = p_ws_id;
end;
$$;

grant execute on function public.cc_replace_ws_excel(uuid, text, text, numeric, numeric, jsonb) to authenticated;
