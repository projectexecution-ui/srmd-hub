-- Reopening a line now also clears its "ERP budget reduced" tick.
--
-- Aksha's call. The first version kept the tick as history on the grounds that
-- the money really did come out of IN4 that day. But the tick's job is not to
-- record history — it is to answer "does this line still have money to take
-- out of the ERP?". Reopening a line means budget is expected to move on it
-- again, so the old answer is stale, and leaving it set would quietly keep the
-- line off the ERP-reduction queue after it is closed a second time.
--
-- The history is not lost: clearing the tick writes its own
-- 'erp_reduction_undone' row to cc_completion_events, carrying the amount and
-- saying plainly that it was the reopen that cleared it, not the ERP person
-- changing their mind. The audit page shows the whole sequence.

create or replace function public.cc_set_completion(
  p_project    uuid,
  p_discipline uuid,
  p_sub_skill  uuid,        -- null = the whole work category
  p_complete   boolean,
  p_note       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid       uuid := (select auth.uid());
  v_touched   int  := 0;
  v_label     text;
  v_prev_at   timestamptz;
  v_prev_amt  numeric;
  r           record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (fn_cc_is_admin(v_uid) or fn_cc_can_admin(v_uid)
          or exists (select 1 from projects p where p.id = p_project and p.pm_user_id = v_uid)) then
    raise exception 'You do not have permission to close work on this project';
  end if;

  -- ─────────── one sub-category ───────────
  if p_sub_skill is not null then
    if p_complete then
      if not fn_cc_sub_closable(p_project, p_discipline, p_sub_skill) then
        raise exception 'WO/PO and Paid do not match on this sub-category, so there is still money outstanding - it cannot be closed yet';
      end if;
      update cc_project_sub_skills
         set completed_at = now(), completed_by = v_uid, completed_note = p_note
       where project_id = p_project and sub_skill_id = p_sub_skill and completed_at is null;
      if found then
        insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, savings_amt, note, actor_id)
        values (p_project, p_discipline, p_sub_skill, 'completed',
                fn_cc_savings(p_project, p_discipline, p_sub_skill), p_note, v_uid);
        v_touched := 1;
      end if;
    else
      -- Read the tick BEFORE clearing it: UPDATE ... RETURNING hands back the
      -- new row, so the old amount has to be captured first.
      select erp_reduced_at, erp_reduced_amt into v_prev_at, v_prev_amt
        from cc_project_sub_skills
       where project_id = p_project and sub_skill_id = p_sub_skill;

      update cc_project_sub_skills
         set completed_at = null, completed_by = null, completed_note = null,
             erp_reduced_at = null, erp_reduced_by = null,
             erp_reduced_amt = null, erp_reduced_note = null
       where project_id = p_project and sub_skill_id = p_sub_skill and completed_at is not null;
      if found then
        insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, note, actor_id)
        values (p_project, p_discipline, p_sub_skill, 'reopened', p_note, v_uid);
        v_touched := 1;
        if v_prev_at is not null then
          insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, savings_amt, note, actor_id)
          values (p_project, p_discipline, p_sub_skill, 'erp_reduction_undone', v_prev_amt,
                  'Cleared because the sub-category was reopened', v_uid);
        end if;
      end if;

      -- A sub-category cannot be open inside a closed category, or the row
      -- would say "open" while the trigger still refused every request.
      update cc_project_disciplines
         set completed_at = null, completed_by = null, completed_note = null
       where project_id = p_project and discipline_id = p_discipline and completed_at is not null;
      if found then
        insert into cc_completion_events(project_id, discipline_id, action, note, actor_id)
        values (p_project, p_discipline, 'reopened', 'Reopened with a sub-category under it', v_uid);
      end if;
    end if;
    return jsonb_build_object('ok', true, 'sub_skills_touched', v_touched);
  end if;

  -- ─────────── the whole work category ───────────
  if p_complete then
    -- Every sub-category that carries money must already be closed, or be
    -- closable right now. One with nothing on it is not unfinished work, it is
    -- an empty row, so it does not hold the category open.
    select string_agg(coalesce(ss.code || ' ', '') || ss.name, ', ' order by ss.code)
      into v_label
      from cc_project_sub_skills ps
      join cc_sub_skills ss on ss.id = ps.sub_skill_id
     where ps.project_id = p_project
       and ps.is_enabled
       and ss.discipline_id = p_discipline
       and ps.completed_at is null
       and exists (select 1 from cc_budget_lines bl
                    where bl.project_id = p_project and bl.discipline_id = p_discipline
                      and bl.sub_skill_id = ps.sub_skill_id
                    having round(coalesce(sum(bl.current_budget_amt), 0)) > 0
                        or round(coalesce(sum(bl.current_wo_committed_amt), 0)) > 0)
       and not fn_cc_sub_closable(p_project, p_discipline, ps.sub_skill_id);

    if v_label is not null then
      raise exception 'These sub-categories still have money outstanding, so this category cannot be closed yet: %', v_label;
    end if;

    for r in
      select ps.sub_skill_id
        from cc_project_sub_skills ps
        join cc_sub_skills ss on ss.id = ps.sub_skill_id
       where ps.project_id = p_project and ps.is_enabled
         and ss.discipline_id = p_discipline
         and ps.completed_at is null
         and fn_cc_sub_closable(p_project, p_discipline, ps.sub_skill_id)
    loop
      update cc_project_sub_skills
         set completed_at = now(), completed_by = v_uid,
             completed_note = coalesce(p_note, 'Closed with the whole work category')
       where project_id = p_project and sub_skill_id = r.sub_skill_id;
      insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, savings_amt, note, actor_id)
      values (p_project, p_discipline, r.sub_skill_id, 'completed',
              fn_cc_savings(p_project, p_discipline, r.sub_skill_id),
              coalesce(p_note, 'Closed with the whole work category'), v_uid);
      v_touched := v_touched + 1;
    end loop;

    insert into cc_project_disciplines (project_id, discipline_id, is_enabled, completed_at, completed_by, completed_note)
    values (p_project, p_discipline, true, now(), v_uid, p_note)
    on conflict (project_id, discipline_id)
      do update set completed_at = now(), completed_by = v_uid, completed_note = p_note;

    insert into cc_completion_events(project_id, discipline_id, action, note, actor_id)
    values (p_project, p_discipline, 'completed', p_note, v_uid);

  else
    -- Reopening a category reopens everything it closed. Symmetry, so that
    -- one click undoes one click and nothing is left silently refusing work.
    for r in
      select ps.sub_skill_id, ps.erp_reduced_at, ps.erp_reduced_amt
        from cc_project_sub_skills ps
        join cc_sub_skills ss on ss.id = ps.sub_skill_id
       where ps.project_id = p_project and ss.discipline_id = p_discipline
         and ps.completed_at is not null
    loop
      update cc_project_sub_skills
         set completed_at = null, completed_by = null, completed_note = null,
             erp_reduced_at = null, erp_reduced_by = null,
             erp_reduced_amt = null, erp_reduced_note = null
       where project_id = p_project and sub_skill_id = r.sub_skill_id;
      insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, note, actor_id)
      values (p_project, p_discipline, r.sub_skill_id, 'reopened',
              coalesce(p_note, 'Reopened with the whole work category'), v_uid);
      v_touched := v_touched + 1;
      if r.erp_reduced_at is not null then
        insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, savings_amt, note, actor_id)
        values (p_project, p_discipline, r.sub_skill_id, 'erp_reduction_undone', r.erp_reduced_amt,
                'Cleared because the work category was reopened', v_uid);
      end if;
    end loop;

    update cc_project_disciplines
       set completed_at = null, completed_by = null, completed_note = null
     where project_id = p_project and discipline_id = p_discipline and completed_at is not null;
    if found then
      insert into cc_completion_events(project_id, discipline_id, action, note, actor_id)
      values (p_project, p_discipline, 'reopened', p_note, v_uid);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'sub_skills_touched', v_touched);
end $fn$;

revoke all on function public.cc_set_completion(uuid, uuid, uuid, boolean, text) from public;
grant execute on function public.cc_set_completion(uuid, uuid, uuid, boolean, text) to authenticated;
