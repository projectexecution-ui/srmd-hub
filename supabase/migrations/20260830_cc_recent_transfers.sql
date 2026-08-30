-- The transfers to show on a project's sub-category rows: the latest movement
-- on each line, and which sub-category it went to or came from.
--
-- An RPC rather than a PostgREST select because the interesting half of the
-- answer is on the OTHER budget line — the one related_budget_line_id points
-- at — and that is a second hop through cc_budget_lines into cc_sub_skills.
create or replace function public.cc_recent_transfers(p_project uuid)
returns table (
  discipline_id uuid,
  sub_skill_id  uuid,
  direction     text,
  amount        numeric,
  other_code    text,
  other_name    text,
  moved_at      timestamptz
)
language sql stable security definer set search_path = public as $fn$
  select distinct on (bl.discipline_id, bl.sub_skill_id)
         bl.discipline_id,
         bl.sub_skill_id,
         case when be.event_type = 'budget_shift_out' then 'out' else 'in' end,
         abs(be.delta_amount),
         oss.code,
         oss.name,
         coalesce(be.event_date, be.created_at)
    from cc_budget_events be
    join cc_budget_lines bl  on bl.id  = be.budget_line_id
    join cc_budget_lines obl on obl.id = be.related_budget_line_id
    join cc_sub_skills   oss on oss.id = obl.sub_skill_id
   where be.project_id = p_project
     and be.event_type in ('budget_shift_in', 'budget_shift_out')
     and bl.sub_skill_id is not null
   order by bl.discipline_id, bl.sub_skill_id,
            coalesce(be.event_date, be.created_at) desc, be.id desc;
$fn$;

revoke all on function public.cc_recent_transfers(uuid) from public;
grant execute on function public.cc_recent_transfers(uuid) to authenticated;
