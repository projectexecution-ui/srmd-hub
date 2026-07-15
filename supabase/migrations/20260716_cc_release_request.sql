-- Engineer's "release the balance" request on a partly released sheet.
-- Sends the sheet back through the SAME approval chain (PH → Atm → Trustee)
-- so the remaining money is released with fresh sign-offs. SECURITY DEFINER
-- because RLS only lets an engineer update their own sheet while it is a
-- draft. The status flip (partially_approved → submitted) has no
-- approval_rules row, so the matrix trigger lets it pass; this RPC is the
-- only sanctioned path and it enforces ownership itself.
create or replace function public.cc_request_release(p_ws uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws record;
  v_balance numeric;
begin
  select id, engineer_id, status, total_amount, approved_for_erp_amt
    into v_ws
    from public.cc_working_sheets
   where id = p_ws
   for update;

  if v_ws.id is null then
    raise exception 'Working Sheet not found';
  end if;
  if v_ws.engineer_id is distinct from auth.uid() and not public.fn_cc_is_admin(auth.uid()) then
    raise exception 'Only the sheet owner can request the balance release';
  end if;
  if v_ws.status <> 'partially_approved' then
    raise exception 'Only a partly released sheet can request a balance release';
  end if;

  v_balance := greatest(coalesce(v_ws.total_amount, 0) - coalesce(v_ws.approved_for_erp_amt, 0), 0);
  if v_balance <= 0 then
    raise exception 'Nothing left to release on this sheet';
  end if;

  update public.cc_working_sheets
     set status = 'submitted', submitted_at = now()
   where id = p_ws and status = 'partially_approved';

  insert into public.approval_events
    (module_slug, doc_type, doc_table, doc_id, from_stage, to_stage, actor_id, decision, comment, attachments)
  values
    ('cost-control', 'cc_working_sheet', 'cc_working_sheets', p_ws,
     'partially_approved', 'submitted', auth.uid(), 'release_requested',
     'Requested release of balance ₹' || to_char(round(v_balance), 'FM99,99,99,99,999')
       || case when nullif(trim(coalesce(p_note, '')), '') is not null then ' — ' || trim(p_note) else '' end,
     '[]'::jsonb);
end $$;

grant execute on function public.cc_request_release(uuid, text) to authenticated;
