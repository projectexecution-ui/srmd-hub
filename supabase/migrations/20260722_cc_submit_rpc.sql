-- Fix: engineers can't submit their own working sheet.
--
-- The cc_ws_update policy has no separate WITH CHECK, so its USING doubles as
-- the check — and the engineer clause is (engineer_id = auth.uid() AND
-- status = 'draft'). Submitting flips status to 'submitted', so the NEW row
-- fails that check → "new row violates row-level security policy for table
-- cc_working_sheets". A direct UPDATE can therefore never work for engineers
-- (nor can editing/resubmitting a 'returned' sheet).
--
-- This SECURITY DEFINER RPC performs the submit after re-checking ownership +
-- state in SQL, matching the other cc_* definer RPCs. No table policy is
-- loosened; the strict engineer USING clause stays as-is.
create or replace function public.cc_submit_working_sheet(p_ws_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ws  record;
begin
  select id, status, engineer_id, total_amount
    into v_ws
  from public.cc_working_sheets
  where id = p_ws_id;
  if not found then
    raise exception 'Working sheet not found';
  end if;

  if v_ws.engineer_id <> v_uid and not public.fn_cc_is_admin(v_uid) then
    raise exception 'Only the sheet owner can submit it for approval';
  end if;
  if v_ws.status::text not in ('draft', 'returned') then
    raise exception 'Only drafts can be submitted';
  end if;
  if coalesce(v_ws.total_amount, 0) <= 0 then
    raise exception 'Add at least one item with amount greater than 0 before submitting';
  end if;

  update public.cc_working_sheets
     set status       = 'submitted'::cc_ws_status,
         submitted_at = now(),
         locked_at    = now(),
         locked_by    = v_uid
   where id = p_ws_id;
end;
$$;

grant execute on function public.cc_submit_working_sheet(uuid) to authenticated;
