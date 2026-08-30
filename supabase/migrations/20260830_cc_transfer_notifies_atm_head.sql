-- Tell the Atm Head when budget moves inside one of his categories.
--
-- The chip and the audit entry are passive: you see them if you happen to open
-- that project. A transfer changes what a category's sub-categories are worth
-- without anything being approved in CT Hub, so the person accountable for the
-- category should not have to go looking.
--
-- Recipient: the project's NAMED Atm Head (cc_project_approvers role 'head') —
-- 39 of the projects have one. If nobody is named, nobody is told; blasting
-- every head on the portfolio would be worse than silence.
--
-- Adds p_notify so a backfill over historical events can label without firing
-- notifications for transfers that happened weeks ago.
--
-- Verified: a ₹4,50,000 move inside AB · 03 Civil reached Amit Gala, AB's named
-- head, reading "₹4,50,000 moved from 305 Masonry Works to 312 Steel
-- Fabrication Works in IN4. The total for 03 Civil is unchanged — this is an
-- internal transfer, not a new approval, so nothing came through the CT Hub
-- chain." (probe rolled back)

-- Indian grouping for money inside SQL. notify_user() messages are read by the
-- same people as the screens, and "1,45,000" is the only grouping this office
-- uses; to_char would render "145,000".
create or replace function public.fn_inr(p numeric)
returns text language plpgsql immutable set search_path = public as $fn$
declare n text; head text; tail text; grouped text := '';
begin
  if p is null then return '—'; end if;
  n := to_char(round(abs(p)), 'FM999999999999999');
  if length(n) <= 3 then
    return (case when p < 0 then '-' else '' end) || '₹' || n;
  end if;
  tail := right(n, 3);
  head := left(n, length(n) - 3);
  while length(head) > 2 loop
    grouped := ',' || right(head, 2) || grouped;
    head := left(head, length(head) - 2);
  end loop;
  return (case when p < 0 then '-' else '' end) || '₹' || head || grouped || ',' || tail;
end $fn$;

create or replace function public.cc_detect_budget_transfers(
  p_project uuid,
  p_after   timestamptz,
  p_notify  boolean default true
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
  v_proj_lbl text;
  v_head record;
begin
  select coalesce(code || ' ', '') || name into v_proj_lbl from projects where id = p_project;

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

    if p_notify then
      for v_head in
        select distinct user_id from cc_project_approvers
         where project_id = p_project and role = 'head' and user_id is not null
      loop
        perform notify_user(
          v_head.user_id,
          'cc_budget_transfer',
          fn_inr(abs(v_out.delta_amount)) || ' moved inside ' || v_cat_lbl || ' · ' || v_proj_lbl,
          fn_inr(abs(v_out.delta_amount)) || ' moved from ' || v_out_lbl || ' to ' || v_in_lbl
            || ' in IN4. The total for ' || v_cat_lbl || ' is unchanged — this is an internal '
            || 'transfer, not a new approval, so nothing came through the CT Hub chain.',
          '/cost-control/projects/' || p_project::text,
          'cost-control'
        );
      end loop;
    end if;
  end loop;

  return v_pairs;
end $fn$;

revoke all on function public.cc_detect_budget_transfers(uuid, timestamptz, boolean) from public;
grant execute on function public.cc_detect_budget_transfers(uuid, timestamptz, boolean) to authenticated;
drop function if exists public.cc_detect_budget_transfers(uuid, timestamptz);
