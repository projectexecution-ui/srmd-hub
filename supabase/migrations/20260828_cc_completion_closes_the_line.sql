-- Closing work, for real this time.
--
-- "Mark complete" until now was a label: it recorded that a sub-category was
-- finished and showed the leftover budget, but nothing followed from it.
-- Three things now follow.
--
--  1. A closed line REFUSES new budget requests, in the database, until
--     somebody reopens it. Not a hidden button — a refusal with a reason.
--  2. It can be done at work-category level, closing every sub-category under
--     it in one action (and reopening them the same way), because closing
--     Civil one sub-category at a time is how it stops getting done.
--  3. The leftover budget still sits in IN4 and has to be taken out by hand.
--     The person who does that (cost-control role `billing` or `coordinator`)
--     ticks it off, and until they do, the money shows as still to remove.
--
-- Every one of those actions is written to cc_completion_events, which the
-- audit page reads.
--
-- Budget / WO / Paid are still authored ONLY by the IN4 -> BPH sync. Nothing
-- here writes a rupee back to cc_budget_lines; the saving is derived and the
-- ERP tick is a record that a human did it over there.

-- ── 1. Category-level completion, mirroring the sub-category columns ──
alter table public.cc_project_disciplines
  add column if not exists completed_at   timestamptz,
  add column if not exists completed_by   uuid references public.profiles(id),
  add column if not exists completed_note text;

comment on column public.cc_project_disciplines.completed_at is
  'Set when management closed this whole work category. Closing it also closes every eligible sub-category under it; reopening it reopens them.';

-- ── 2. The ERP budget reduction, recorded where the money is ──
alter table public.cc_project_sub_skills
  add column if not exists erp_reduced_at   timestamptz,
  add column if not exists erp_reduced_by   uuid references public.profiles(id),
  add column if not exists erp_reduced_amt  numeric,
  add column if not exists erp_reduced_note text;

comment on column public.cc_project_sub_skills.erp_reduced_amt is
  'The leftover budget as it stood when Billing/Coordinator confirmed they had removed it from IN4. Frozen at that moment — the live saving is derived from cc_budget_lines and moves with the next BPH sync.';

-- ── 3. The audit trail ──
create table if not exists public.cc_completion_events (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  discipline_id uuid not null references public.cc_disciplines(id),
  -- null = the event is about the whole work category
  sub_skill_id  uuid references public.cc_sub_skills(id),
  action        text not null check (action in ('completed', 'reopened', 'erp_reduced', 'erp_reduction_undone')),
  savings_amt   numeric,
  note          text,
  actor_id      uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create index if not exists cc_completion_events_project_idx
  on public.cc_completion_events (project_id, created_at desc);

alter table public.cc_completion_events enable row level security;

drop policy if exists cc_completion_events_read on public.cc_completion_events;
create policy cc_completion_events_read on public.cc_completion_events
  for select using (public.fn_cc_user_in_project((select auth.uid()), project_id));
-- No write policy: rows are written only by the SECURITY DEFINER functions
-- below, so an event can never be forged without going through the rules.

-- ── Shared rules, so SQL and TypeScript agree on what "closable" means ──

/** WO/PO committed exists and equals Paid to the rupee. Mirrors
 *  lib/cost-control/completion.ts — keep the two in step. */
create or replace function public.fn_cc_sub_closable(p_project uuid, p_disc uuid, p_sub uuid)
returns boolean language sql stable set search_path = public as $$
  select round(coalesce(sum(current_wo_committed_amt), 0)) > 0
     and round(coalesce(sum(current_wo_committed_amt), 0)) = round(coalesce(sum(current_paid_amt), 0))
  from public.cc_budget_lines
  where project_id = p_project and discipline_id = p_disc and sub_skill_id = p_sub;
$$;

/** Budget left over once the line is closed — the money to take out of IN4. */
create or replace function public.fn_cc_savings(p_project uuid, p_disc uuid, p_sub uuid)
returns numeric language sql stable set search_path = public as $$
  select greatest(0, round(coalesce(sum(current_budget_amt), 0)) - round(coalesce(sum(current_paid_amt), 0)))
  from public.cc_budget_lines
  where project_id = p_project and discipline_id = p_disc and sub_skill_id = p_sub;
$$;

-- ── 4. Close / reopen ──
--
-- SECURITY DEFINER because it writes cc_completion_events, which has no write
-- policy. The permission check below is the SAME test the cc_proj_ss_write
-- policy applies, so this grants nobody anything they did not already have.
create or replace function public.cc_set_completion(
  p_project    uuid,
  p_discipline uuid,
  p_sub_skill  uuid,        -- null = the whole work category
  p_complete   boolean,
  p_note       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := (select auth.uid());
  v_touched int  := 0;
  v_label   text;
  r         record;
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
        raise exception 'WO/PO and Paid do not match on this sub-category, so there is still money outstanding — it cannot be closed yet';
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
      update cc_project_sub_skills
         set completed_at = null, completed_by = null, completed_note = null
       where project_id = p_project and sub_skill_id = p_sub_skill and completed_at is not null;
      if found then
        insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, note, actor_id)
        values (p_project, p_discipline, p_sub_skill, 'reopened', p_note, v_uid);
        v_touched := 1;
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

    -- Close every still-open sub-category that carries money.
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
      select ps.sub_skill_id
        from cc_project_sub_skills ps
        join cc_sub_skills ss on ss.id = ps.sub_skill_id
       where ps.project_id = p_project and ss.discipline_id = p_discipline
         and ps.completed_at is not null
    loop
      update cc_project_sub_skills
         set completed_at = null, completed_by = null, completed_note = null
       where project_id = p_project and sub_skill_id = r.sub_skill_id;
      insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, note, actor_id)
      values (p_project, p_discipline, r.sub_skill_id, 'reopened',
              coalesce(p_note, 'Reopened with the whole work category'), v_uid);
      v_touched := v_touched + 1;
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
end $$;

revoke all on function public.cc_set_completion(uuid, uuid, uuid, boolean, text) from public;
grant execute on function public.cc_set_completion(uuid, uuid, uuid, boolean, text) to authenticated;

-- ── 5. "The ERP budget has been reduced too" ──
--
-- Deliberately NOT the same permission as closing. Management decides the work
-- is finished; the person who keys IN4 confirms the money actually came out.
-- Same two roles the billing queue already uses.
create or replace function public.cc_set_erp_reduced(
  p_project    uuid,
  p_discipline uuid,
  p_sub_skill  uuid,
  p_reduced    boolean,
  p_note       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  v_amt  numeric;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  v_role := effective_user_role(v_uid, 'cost-control');
  if not (fn_cc_is_admin(v_uid) or v_role in ('billing', 'coordinator')) then
    raise exception 'Only Billing or the Coordinator can confirm that the ERP budget was reduced';
  end if;

  if p_reduced then
    if not exists (select 1 from cc_project_sub_skills
                    where project_id = p_project and sub_skill_id = p_sub_skill
                      and completed_at is not null) then
      raise exception 'This sub-category is not closed, so there is no leftover budget to remove yet';
    end if;
    v_amt := fn_cc_savings(p_project, p_discipline, p_sub_skill);
    update cc_project_sub_skills
       set erp_reduced_at = now(), erp_reduced_by = v_uid,
           erp_reduced_amt = v_amt, erp_reduced_note = p_note
     where project_id = p_project and sub_skill_id = p_sub_skill and erp_reduced_at is null;
    if found then
      insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, savings_amt, note, actor_id)
      values (p_project, p_discipline, p_sub_skill, 'erp_reduced', v_amt, p_note, v_uid);
    end if;
  else
    update cc_project_sub_skills
       set erp_reduced_at = null, erp_reduced_by = null, erp_reduced_amt = null, erp_reduced_note = null
     where project_id = p_project and sub_skill_id = p_sub_skill and erp_reduced_at is not null;
    if found then
      insert into cc_completion_events(project_id, discipline_id, sub_skill_id, action, note, actor_id)
      values (p_project, p_discipline, p_sub_skill, 'erp_reduction_undone', p_note, v_uid);
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cc_set_erp_reduced(uuid, uuid, uuid, boolean, text) from public;
grant execute on function public.cc_set_erp_reduced(uuid, uuid, uuid, boolean, text) to authenticated;

-- ── 6. A closed line refuses new requests ──
--
-- In the database, not just the UI: /new-quick inserts straight from the
-- browser, so a check that only lived in React would be a suggestion.
create or replace function public.cc_ws_block_when_closed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lbl text;
begin
  -- Internal Estimate baselines ([IB…]) are management's own record of what
  -- the work should cost, not a request for money. They are not blocked.
  if coalesce(new.summary_notes, '') like '[IB%' then
    return new;
  end if;

  if new.sub_skill_id is not null and exists (
       select 1 from cc_project_sub_skills
        where project_id = new.project_id and sub_skill_id = new.sub_skill_id
          and completed_at is not null) then
    select coalesce(code || ' ', '') || name into v_lbl from cc_sub_skills where id = new.sub_skill_id;
    raise exception 'Cannot raise a request: the sub-category % is marked Completed. Reopen it first.', coalesce(v_lbl, '');
  end if;

  if new.discipline_id is not null and exists (
       select 1 from cc_project_disciplines
        where project_id = new.project_id and discipline_id = new.discipline_id
          and completed_at is not null) then
    select coalesce(code || ' ', '') || name into v_lbl from cc_disciplines where id = new.discipline_id;
    raise exception 'Cannot raise a request: the work category % is marked Completed. Reopen it first.', coalesce(v_lbl, '');
  end if;

  return new;
end $$;

drop trigger if exists trg_cc_ws_block_when_closed on public.cc_working_sheets;
create trigger trg_cc_ws_block_when_closed
  before insert on public.cc_working_sheets
  for each row execute function public.cc_ws_block_when_closed();

-- ── 7. The queue the ERP person works from ──
--
-- Closed sub-categories whose leftover budget is still sitting in IN4. Without
-- this the tick exists but is unfindable — nobody opens 42 projects looking for
-- it. SECURITY DEFINER so the two IN4 roles can read across projects without
-- being given project membership everywhere; the role check is the gate.
create or replace function public.cc_erp_reduction_queue()
returns table (
  project_id    uuid,
  project_code  text,
  project_name  text,
  discipline_id uuid,
  disc_code     text,
  disc_name     text,
  sub_skill_id  uuid,
  sub_code      text,
  sub_name      text,
  completed_at  timestamptz,
  savings       numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  v_role := effective_user_role(v_uid, 'cost-control');
  if not (fn_cc_is_admin(v_uid) or v_role in ('billing', 'coordinator')) then
    raise exception 'This queue is for Billing and the Coordinator';
  end if;

  return query
  select pr.id, pr.code, pr.name,
         ss.discipline_id, d.code, d.name,
         ss.id, ss.code, ss.name,
         ps.completed_at,
         fn_cc_savings(ps.project_id, ss.discipline_id, ss.id)
    from cc_project_sub_skills ps
    join cc_sub_skills  ss on ss.id = ps.sub_skill_id
    join cc_disciplines d  on d.id  = ss.discipline_id
    join projects       pr on pr.id = ps.project_id
   where ps.completed_at is not null
     and ps.erp_reduced_at is null
     and fn_cc_savings(ps.project_id, ss.discipline_id, ss.id) > 0
   order by ps.completed_at;
end $$;

revoke all on function public.cc_erp_reduction_queue() from public;
grant execute on function public.cc_erp_reduction_queue() to authenticated;
