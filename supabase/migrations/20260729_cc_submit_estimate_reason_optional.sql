-- The per-row estimate reason (qty_note on a no-drawing row) is now OPTIONAL —
-- engineers may add it but are no longer blocked from submitting without it.
-- The mandatory working-file attachment is unchanged. (Removes only the
-- estimate-reason enforcement from cc_submit_working_sheet.)
create or replace function public.cc_submit_working_sheet(p_ws_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ws  record;
  v_flag_on boolean;
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

  select lower(coalesce(value,'')) in ('true','1','on')
    into v_flag_on
  from public.app_settings
  where key = 'cc_cumulative_versions';
  v_flag_on := coalesce(v_flag_on, false);

  -- Working file (measurement / backup) stays mandatory; the per-row estimate
  -- reason is optional (no longer enforced here).
  if v_flag_on and not public.fn_cc_is_admin(v_uid) then
    if not exists (select 1 from public.cc_ws_attachments where working_sheet_id = p_ws_id) then
      raise exception 'Attach at least one working file (measurement / backup) before submitting';
    end if;
  end if;

  update public.cc_working_sheets
     set status       = 'submitted'::cc_ws_status,
         submitted_at = now(),
         locked_at    = now(),
         locked_by    = v_uid
   where id = p_ws_id;
end;
$function$;
