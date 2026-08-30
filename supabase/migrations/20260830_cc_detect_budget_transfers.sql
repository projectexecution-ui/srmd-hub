-- Recognise an internal IN4 transfer and record it as ONE movement.
--
-- The BPH sync writes a budget_update per line it changed, so a transfer of
-- ₹3,00,000 from 1201 Doors to 1209 Painting arrives as two unrelated events:
-- one -₹3,00,000 and one +₹3,00,000, with nothing saying they are the same
-- money. This runs once at the end of a sync and re-labels matched pairs as
-- budget_shift_out / budget_shift_in, pointing each at the other through
-- related_budget_line_id — the two columns that have existed for this since the
-- table was designed and have never carried a row.
--
-- The match is deliberately strict, because a loose one lies. It requires:
--   * the same project and the same WORK CATEGORY — an HOD-sanctioned transfer
--     is inside a category, and matching across categories would invent one;
--   * two DIFFERENT sub-categories — most equal-and-opposite pairs in the
--     history are one line corrected twice in a single upload (AB1F 1201 Doors
--     went 10,11,024 -> 2,20,714 -> 10,11,024 on 18 Aug), which is a correction,
--     not a movement;
--   * exactly equal and opposite amounts;
--   * both written by the same sync run.
--
-- Anything it cannot match with confidence it leaves exactly as it is. A
-- budget_update that is really half of a transfer but does not pair cleanly
-- stays a budget_update, which is the honest outcome — no claim is made.
--
-- SUPERSEDED by 20260830_cc_transfer_notifies_atm_head.sql, which adds the
-- p_notify argument and the Atm Head notification. Kept for history.
--
-- The amount is NOT written into the remark: delta_amount already holds it and
-- the UI formats money in Indian grouping. The remark carries the relationship.

create or replace function public.cc_detect_budget_transfers(
  p_project uuid,
  p_after   timestamptz
) returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_pairs int := 0;
  v_out   record;
  v_in_id uuid;
  v_in_line uuid;
  v_still  text;
  v_out_lbl text;
  v_in_lbl  text;
  v_cat_lbl text;
begin
  for v_out in
    select be.id, be.budget_line_id, be.delta_amount,
           bl.discipline_id, bl.sub_skill_id
      from cc_budget_events be
      join cc_budget_lines bl on bl.id = be.budget_line_id
     where be.project_id = p_project
       and be.created_at >= p_after
       and be.event_type in ('budget_add', 'budget_update')
       and be.delta_amount < 0
       and bl.sub_skill_id is not null
     order by be.delta_amount, be.id
  loop
    -- The cursor holds a snapshot, so a row relabelled earlier in this loop can
    -- still turn up here. Re-read before claiming it.
    select event_type::text into v_still from cc_budget_events where id = v_out.id;
    if v_still not in ('budget_add', 'budget_update') then continue; end if;

    select be2.id, be2.budget_line_id into v_in_id, v_in_line
      from cc_budget_events be2
      join cc_budget_lines bl2 on bl2.id = be2.budget_line_id
     where be2.project_id = p_project
       and be2.created_at >= p_after
       and be2.event_type in ('budget_add', 'budget_update')
       and be2.delta_amount = -v_out.delta_amount
       and bl2.discipline_id = v_out.discipline_id
       and bl2.sub_skill_id is not null
       and bl2.sub_skill_id <> v_out.sub_skill_id
     order by be2.id
     limit 1;

    if v_in_id is null then continue; end if;

    select coalesce(code || ' ', '') || name into v_out_lbl
      from cc_sub_skills where id = v_out.sub_skill_id;
    select coalesce(ss.code || ' ', '') || ss.name into v_in_lbl
      from cc_budget_lines bl join cc_sub_skills ss on ss.id = bl.sub_skill_id
     where bl.id = v_in_line;
    select coalesce(code || ' ', '') || name into v_cat_lbl
      from cc_disciplines where id = v_out.discipline_id;

    update cc_budget_events
       set event_type = 'budget_shift_out',
           related_budget_line_id = v_in_line,
           remarks = ('Moved to ' || v_in_lbl || ' — internal transfer inside ' || v_cat_lbl)
     where id = v_out.id;

    update cc_budget_events
       set event_type = 'budget_shift_in',
           related_budget_line_id = v_out.budget_line_id,
           remarks = ('Moved from ' || v_out_lbl || ' — internal transfer inside ' || v_cat_lbl)
     where id = v_in_id;

    v_pairs := v_pairs + 1;
  end loop;

  return v_pairs;
end $fn$;

revoke all on function public.cc_detect_budget_transfers(uuid, timestamptz) from public;
grant execute on function public.cc_detect_budget_transfers(uuid, timestamptz) to authenticated;
