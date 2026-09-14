-- The abstract number is recorded where it actually arrives, not at entry.
--
-- Aksha, 14 Sep 2026, looking at the entry form: "why Abstract Number - that
-- will come ahead in process na ???"
--
-- He is right, and it was worse than a spare field. The abstract is filled by
-- the Site Head in IN4 AFTER the bill is entered — that is the second step of
-- the flow. So the one place the number could be typed was the one moment it
-- cannot exist, and the form said "if one exists already", which is hedging
-- rather than thinking. Every bill would have carried a blank there for ever,
-- because nothing anywhere could set it afterwards.
--
-- bb_bills has no update policy for any user by design — every write goes
-- through a SECURITY DEFINER function — so recording it needs one of these.
--
-- It writes an event as well. Aksha, 13 Sep: "the Team has the power of
-- resubmit - cancel - lock - etc powers - so u should understand all properly
-- and keep all those trials as well in records and dont miss any minute
-- details". Changing the number that ties a CT Hub bill to its IN4 document is
-- exactly such a detail.

create or replace function public.bb_rpc_set_abstract(p_bill uuid, p_abstract text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor uuid := auth.uid(); v_edit boolean; v_old text; v_new text; v_stage bb_stage;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role
      and rp.module_slug = 'bills-booking' and rp.can_edit = true) into v_edit;
  if not v_edit then raise exception 'You do not have permission to change bills'; end if;

  v_new := nullif(btrim(coalesce(p_abstract, '')), '');

  select abstract_no_in4, current_stage into v_old, v_stage
  from public.bb_bills where id = p_bill;
  if not found then raise exception 'That bill does not exist'; end if;

  -- Nothing to record when nothing changed; a trail full of "set it to what it
  -- already was" is a trail nobody reads.
  if v_old is not distinct from v_new then
    return jsonb_build_object('status','unchanged','abstract', v_new);
  end if;

  update public.bb_bills set abstract_no_in4 = v_new where id = p_bill;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, actor_id)
  values (p_bill, v_stage, v_stage, 'abstract',
          case
            when v_new is null then 'Abstract number cleared (was ' || v_old || ')'
            when v_old is null then 'Abstract number recorded: ' || v_new
            else 'Abstract number changed from ' || v_old || ' to ' || v_new
          end,
          v_actor);

  return jsonb_build_object('status','ok','abstract', v_new);
end $function$;

grant execute on function public.bb_rpc_set_abstract(uuid, text) to authenticated;
