-- Let the engineer who created a DRAFT working sheet delete it (e.g. raised in
-- the wrong sub-category). Draft-only: once it is sent for approval it can no
-- longer be removed. Admins may also use it. [IB] Internal Estimate baselines
-- and archived sheets are excluded. Children cascade
-- (cc_excel_rows / _items / _edits / _attachments / _comments).
create or replace function public.cc_delete_draft(p_ws uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ws record;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select id, engineer_id, status, summary_notes, archived_at
    into v_ws from public.cc_working_sheets where id = p_ws for update;
  if not found then raise exception 'Working sheet not found'; end if;

  if coalesce(v_ws.summary_notes, '') like '[IB%' then
    raise exception 'Internal Estimate baselines cannot be deleted here';
  end if;
  if v_ws.archived_at is not null then
    raise exception 'This sheet is archived — manage it from the Archived list';
  end if;
  if v_ws.status <> 'draft' then
    raise exception 'Only a draft can be deleted. Once it is sent for approval it can no longer be removed.';
  end if;
  if v_ws.engineer_id is distinct from auth.uid() and not public.fn_cc_is_admin(auth.uid()) then
    raise exception 'Only the engineer who created this draft can delete it';
  end if;

  -- Guarded again on status to be safe against a concurrent submit.
  delete from public.cc_working_sheets where id = p_ws and status = 'draft';
  return jsonb_build_object('ok', true);
end;
$function$;
