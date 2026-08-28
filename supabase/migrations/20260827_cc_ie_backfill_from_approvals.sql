-- Backfill: apply the HOD's rule to budgets released BEFORE the trigger existed.
--
-- fn_cc_ie_follow_approval only fires on future releases, so without this the 45
-- already-released lines would keep a wrong or absent estimate forever —
-- including the ₹12,00,000 "201 Excavation & Backfilling" placeholder repeated
-- across seven projects against budgets three to four times that.
--
-- Runs AS THE ADMIN on purpose. cc_bl_gate_estimate reverts internal_estimate_*
-- whenever can_approve(...'estimate_set') is false, and in a migration
-- auth.uid() is null, so it always is. The gate does not raise — it quietly
-- restores the old values, which is how two earlier attempts at this migration
-- reported success and changed nothing. Setting the claim makes the gate pass
-- and stamps internal_estimate_set_by with a real person rather than a fiction.
--
-- Same comparison as the trigger, and it only ever RAISES.
-- Every id is derived; nothing is hardcoded.

select set_config('request.jwt.claim.sub',
                  (select id::text from public.profiles
                   where email = 'projectexecution@construction.srmd.org' limit 1),
                  true);

update public.cc_budget_lines bl
set internal_estimate_amt   = t.amt,
    internal_estimate_notes = 'Backfilled to the approved amount (previous estimate ' || t.ie_now || ')',
    updated_at              = now()
from (
  with released as (
    select project_id, discipline_id, sub_skill_id, sum(chain_max) as amt
    from (
      select project_id, discipline_id, sub_skill_id,
             max(coalesce(approved_for_erp_amt,0)) as chain_max
      from public.cc_ws_with_versions
      where archived_at is null and status::text <> 'cancelled'
        and coalesce(summary_notes,'') not like '[IB%'
        and project_id is not null and discipline_id is not null and sub_skill_id is not null
      group by project_id, discipline_id, sub_skill_id, coalesce(chain_anchor_id, id)
    ) c group by 1,2,3
  ),
  ib as (
    select project_id, discipline_id, sub_skill_id, sum(amt) as ib_amt
    from (
      select distinct on (coalesce(chain_anchor_id, id))
             project_id, discipline_id, sub_skill_id, coalesce(total_amount,0) as amt
      from public.cc_ws_with_versions
      where archived_at is null and status::text <> 'cancelled'
        and coalesce(summary_notes,'') like '[IB%'
      order by coalesce(chain_anchor_id, id), coalesce(version_no,1) desc
    ) x group by 1,2,3
  )
  select r.project_id, r.discipline_id, r.sub_skill_id, r.amt,
         round(coalesce(l.internal_estimate_amt, ib.ib_amt, 0)) as ie_now
  from released r
  left join ib using (project_id, discipline_id, sub_skill_id)
  left join public.cc_budget_lines l on l.project_id=r.project_id and l.discipline_id=r.discipline_id
       and l.sub_skill_id=r.sub_skill_id and l.line_type='work'
  where r.amt > 0 and round(r.amt) > round(coalesce(l.internal_estimate_amt, ib.ib_amt, 0))
) t
where bl.project_id    = t.project_id
  and bl.discipline_id = t.discipline_id
  and bl.sub_skill_id  = t.sub_skill_id
  and bl.line_type     = 'work';
