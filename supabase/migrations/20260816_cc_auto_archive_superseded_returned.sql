-- A returned sheet that has been SUPERSEDED should not haunt the lists forever.
--
-- The real case: GEB Construction Electricity (P2RHCE) was returned at
-- Rs 4,00,000. The engineer did not edit it — he raised a NEW sheet for the same
-- sub-skill at Rs 2,00,000, which was approved. The old one stayed `returned`
-- and non-archived, so it kept showing as outstanding and kept double-counting
-- the project total.
--
-- When a sheet reaches an approved state, any OLDER sheet for the same project
-- and the same work that is still sitting `returned` is archived. Deliberately
-- narrow: only `returned` sheets (nothing in flight is touched), only the same
-- work, only older ones.
--
-- Note on `decision`: approval_events constrains it to
-- approved|rejected|returned|submitted|cancelled|noted. 'cancelled' is the
-- honest fit — the sheet was abandoned in favour of a replacement.
create or replace function public.fn_cc_archive_superseded_returned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_ids uuid[];
begin
  if new.status::text not in ('approved', 'partially_approved', 'atm_approved')
     or (old.status is not distinct from new.status) then
    return new;
  end if;

  with superseded as (
    update public.cc_working_sheets old_ws
       set archived_at = now(),
           archived_by = coalesce(new.engineer_id, old_ws.engineer_id)
     where old_ws.id <> new.id
       and old_ws.project_id = new.project_id
       and old_ws.status::text = 'returned'
       and old_ws.archived_at is null
       and old_ws.created_at < new.created_at
       -- "same work": same sub-skill, or same discipline when neither has one
       and ( (new.sub_skill_id is not null and old_ws.sub_skill_id = new.sub_skill_id)
             or (new.sub_skill_id is null and old_ws.sub_skill_id is null
                 and new.discipline_id is not null and old_ws.discipline_id = new.discipline_id) )
    returning old_ws.id
  )
  select array_agg(id) into v_ids from superseded;

  -- leave a trail, so an archived sheet can always explain itself
  if v_ids is not null and array_length(v_ids, 1) > 0 then
    insert into public.approval_events
      (module_slug, doc_type, doc_table, doc_id, from_stage, to_stage, actor_id, decision, comment)
    select 'cost-control', 'cc_working_sheet', 'cc_working_sheets', x.id,
           'returned', 'archived', null, 'cancelled',
           'Archived automatically — replaced by ' || coalesce(new.ws_code, 'a newer sheet')
             || ', which was ' || new.status::text || '.'
    from unnest(v_ids) as x(id);
  end if;

  return new;
end $$;

drop trigger if exists cc_archive_superseded_returned on public.cc_working_sheets;
create trigger cc_archive_superseded_returned
  after update of status on public.cc_working_sheets
  for each row execute function public.fn_cc_archive_superseded_returned();

-- Backfill for sheets superseded before the trigger existed: three cases,
-- Rs 23,00,000 of ghost budget inflating project totals.
with stale as (
  select distinct on (old_ws.id)
         old_ws.id, newer.ws_code as replaced_by, newer.status::text as new_status
  from cc_working_sheets old_ws
  join cc_working_sheets newer
    on newer.project_id = old_ws.project_id
   and newer.id <> old_ws.id
   and newer.created_at > old_ws.created_at
   and newer.archived_at is null
   and newer.status::text in ('approved','partially_approved','atm_approved')
   and ( (old_ws.sub_skill_id is not null and newer.sub_skill_id = old_ws.sub_skill_id)
         or (old_ws.sub_skill_id is null and newer.sub_skill_id is null
             and old_ws.discipline_id is not null and newer.discipline_id = old_ws.discipline_id) )
  where old_ws.status::text = 'returned' and old_ws.archived_at is null
  order by old_ws.id, newer.created_at desc
),
archived as (
  update cc_working_sheets ws set archived_at = now()
    from stale s where ws.id = s.id
  returning ws.id
)
insert into approval_events
  (module_slug, doc_type, doc_table, doc_id, from_stage, to_stage, actor_id, decision, comment)
select 'cost-control', 'cc_working_sheet', 'cc_working_sheets', s.id,
       'returned', 'archived', null, 'cancelled',
       'Archived automatically — replaced by ' || coalesce(s.replaced_by, 'a newer sheet')
         || ', which was ' || s.new_status || '.'
from stale s;
