-- Include the note that accompanied the action (the mandatory "why this budget"
-- comment at submit, or the sign-off note) in the approval notification data, so
-- the email can show it and an approver can judge without opening the app.
-- Additive: only adds 'note'/'note_by' keys to the cost-control approval payload.
create or replace function public.notify_on_approval_event()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor text; v_recipient uuid; v_summary text; v_url text; v_title text;
  v_data jsonb := null;
  v_ws public.cc_working_sheets%rowtype;
  v_pcode text; v_pname text; v_sft numeric; v_sub text; v_eng text; v_est numeric;
  v_idx int; v_stage text;
  v_flag boolean; v_prior numeric;
  v_note text;
begin
  select coalesce(name, full_name, email) into v_actor from public.profiles where id = new.actor_id;
  v_summary := coalesce(v_actor, 'Someone') || ' ' || new.decision || ' a ' || new.doc_type
            || ' (' || new.from_stage || ' → ' || new.to_stage || ')';
  v_url := '/approvals';
  v_title := 'Action needed: ' || new.doc_type;

  if new.module_slug = 'cost-control' and new.doc_type = 'cc_working_sheet' then
    select * into v_ws from public.cc_working_sheets where id = new.doc_id;
    if found then
      select code, name, nullif(built_up_sft, 0) into v_pcode, v_pname, v_sft from public.projects where id = v_ws.project_id;
      select name into v_sub from public.cc_sub_skills where id = v_ws.sub_skill_id;
      select coalesce(full_name, name) into v_eng from public.profiles where id = v_ws.engineer_id;
      select total_amount into v_est from public.cc_working_sheets
        where project_id = v_ws.project_id and sub_skill_id = v_ws.sub_skill_id
          and summary_notes like '[IB%' and status::text <> 'cancelled'
        order by created_at desc limit 1;

      if new.to_stage = 'submitted' then v_idx := 2; v_stage := 'Project Head sign-off';
      elsif new.to_stage = 'ph_approved' then v_idx := 3; v_stage := 'Atm Head sign-off';
      elsif new.to_stage in ('atm_approved', 'partially_approved') then v_idx := 4; v_stage := 'Trustee release';
      else v_idx := 2; v_stage := 'sign-off';
      end if;

      v_title := 'A budget needs your ' || v_stage;
      v_url := '/cost-control/working-sheets/' || v_ws.id::text;
      v_data := jsonb_build_object(
        'amount', round(coalesce(v_ws.total_amount, 0)),
        'per_sft', case when v_sft is not null and v_sft > 0 then round(coalesce(v_ws.total_amount, 0) / v_sft) else null end,
        'stage_label', v_stage,
        'stage_index', v_idx,
        'project', coalesce(v_pcode, '') || case when v_pname is not null then ' · ' || v_pname else '' end,
        'work', coalesce(v_sub, v_ws.ws_code),
        'raised_by', v_eng,
        'waiting_days', case when v_ws.submitted_at is not null then greatest(extract(day from now() - v_ws.submitted_at)::int, 0) else 0 end,
        'estimate', case when v_est is not null then round(v_est) else null end
      );

      select lower(coalesce(value,'')) in ('true','1','on') into v_flag
        from public.app_settings where key = 'cc_cumulative_versions';
      v_flag := coalesce(v_flag, false);
      if v_flag then
        select total_amount into v_prior
        from public.cc_working_sheets
        where project_id = v_ws.project_id
          and discipline_id = v_ws.discipline_id
          and coalesce(sub_skill_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(v_ws.sub_skill_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and line_type = v_ws.line_type
          and id <> v_ws.id
          and created_at < v_ws.created_at
          and coalesce(summary_notes, '') not like '[IB%'
          and status::text in ('approved', 'partially_approved', 'wo_issued', 'paid')
        order by created_at desc limit 1;
        v_data := v_data || jsonb_build_object(
          'already_approved', round(coalesce(v_prior, 0)),
          'cumulative', round(coalesce(v_ws.total_amount, 0))
        );
      end if;

      -- The note that came with THIS action. Prefer the event's own comment
      -- (sign-off / release note); fall back to the sheet's latest comment
      -- (the mandatory "why" the engineer adds at Send-for-approval, which is
      -- written to cc_ws_comments just before the submit event fires).
      v_note := nullif(btrim(coalesce(new.comment, '')), '');
      if v_note is null then
        select body into v_note from public.cc_ws_comments
          where ws_id = new.doc_id order by created_at desc limit 1;
      end if;
      if v_note is not null then
        v_data := v_data || jsonb_build_object('note', left(v_note, 500), 'note_by', v_actor);
      end if;
    end if;
  end if;

  for v_recipient in
    select distinct p.id
    from public.profiles p, public.approval_rules ar
    where p.is_active = true
      and ar.is_active = true
      and ar.module_slug = new.module_slug
      and ar.doc_type    = new.doc_type
      and ar.from_stage  = new.to_stage
      and (public.effective_user_role(p.id, ar.module_slug)::text = ar.approver_role
        or public.effective_user_role(p.id, ar.module_slug)::text = ar.override_role)
      and p.id <> coalesce(new.actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    perform public.notify_user(v_recipient, 'approval_pending', v_title, v_summary, v_url,
                               new.module_slug, new.doc_table, new.doc_id, v_data);
  end loop;

  return new;
end $function$;
