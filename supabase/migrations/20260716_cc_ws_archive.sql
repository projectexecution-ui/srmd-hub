-- Working Sheet archive: admin (or admin-granted users via the
-- cc_archive_users setting) can archive a WS out of the working lists,
-- restore it, or (admin only, archived-first) delete it permanently.
-- Applied to prod via MCP on 2026-07-14.

alter table public.cc_working_sheets
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

create or replace view public.cc_ws_with_versions as
 with grouped as (
         select ws.id, ws.ws_code, ws.project_id, ws.discipline_id, ws.sub_skill_id,
            ws.line_type, ws.status, ws.engineer_id, ws.total_amount,
            ws.past_approved_in_subskill, ws.created_at, ws.submitted_at,
            ws.approved_at, ws.approved_by, ws.returned_at, ws.returned_by,
            ws.return_reason, ws.locked_at, ws.locked_by, ws.entry_mode,
            ws.source_excel_url, ws.source_excel_name, ws.summary_total,
            ws.summary_notes, ws.flag_summary, ws.last_checked_at,
            ws.deadline_date, ws.deadline_notes, ws.approved_for_erp_amt,
            ws.approved_for_erp_at, ws.approved_for_erp_by, ws.ai_parse_meta,
            ws.break_chain, ws.ai_preset_prompts,
            ws.archived_at, ws.archived_by,
            sum(case when ws.break_chain then 1 else 0 end)
              over (partition by ws.project_id, ws.discipline_id, ws.sub_skill_id, ws.line_type
                    order by ws.created_at, ws.id
                    rows between unbounded preceding and current row) as chain_group
           from cc_working_sheets ws
        )
 select id, ws_code, project_id, discipline_id, sub_skill_id, line_type, status,
    engineer_id, total_amount, past_approved_in_subskill, created_at,
    submitted_at, approved_at, approved_by, returned_at, returned_by,
    return_reason, locked_at, locked_by, entry_mode, source_excel_url,
    source_excel_name, summary_total, summary_notes, flag_summary,
    last_checked_at, deadline_date, deadline_notes, approved_for_erp_amt,
    approved_for_erp_at, approved_for_erp_by, ai_parse_meta, break_chain,
    ai_preset_prompts, chain_group,
    first_value(id) over (partition by project_id, discipline_id, sub_skill_id, line_type, chain_group
                          order by created_at, id
                          rows between unbounded preceding and unbounded following) as chain_anchor_id,
    row_number() over (partition by project_id, discipline_id, sub_skill_id, line_type, chain_group
                       order by created_at, id) as version_no,
    count(*) over (partition by project_id, discipline_id, sub_skill_id, line_type, chain_group) as chain_size,
    archived_at, archived_by
   from grouped g;

create or replace function public.cc_archive_ws(p_ws uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_is_admin boolean;
  v_granted boolean;
  v_archived timestamptz;
begin
  v_role := public.effective_user_role(auth.uid(), 'cost-control')::text;
  v_is_admin := (v_role = 'admin');
  v_granted := v_is_admin or position(auth.uid()::text in coalesce(
      (select value from public.app_settings where key = 'cc_archive_users'), '')) > 0;

  select archived_at into v_archived from public.cc_working_sheets where id = p_ws for update;
  if not found then raise exception 'Working sheet not found'; end if;

  if p_action = 'archive' then
    if not v_granted then raise exception 'You are not allowed to archive working sheets'; end if;
    if v_archived is not null then return jsonb_build_object('ok', true, 'noop', true); end if;
    update public.cc_working_sheets
       set archived_at = now(), archived_by = auth.uid()
     where id = p_ws;
  elsif p_action = 'restore' then
    if not v_granted then raise exception 'You are not allowed to restore working sheets'; end if;
    update public.cc_working_sheets
       set archived_at = null, archived_by = null
     where id = p_ws;
  elsif p_action = 'delete' then
    if not v_is_admin then raise exception 'Only an Admin can permanently delete a working sheet'; end if;
    if v_archived is null then raise exception 'Archive the sheet first, then delete it from the Archived list'; end if;
    delete from public.cc_excel_rows where working_sheet_id = p_ws;
    delete from public.cc_ws_comments where ws_id = p_ws;
    delete from public.cc_working_sheets where id = p_ws;
  else
    raise exception 'Unknown action %', p_action;
  end if;

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$$;

grant execute on function public.cc_archive_ws(uuid, text) to authenticated;
