-- The Internal Estimate follows the approval — the HOD's rule.
--
--   1. If a budget is approved for MORE than the established IE, the IE becomes
--      that approved amount.
--   2. If no IE was ever established, the approved amount becomes the IE.
--
-- His reason, and it is what makes this correct rather than merely convenient:
-- "Internal Estimate Numbers are for our reference so it should be updated as
-- new Dwgs or changes happen which while making IE is not considered." The
-- estimate was built before the drawings and changes existed. It is a living
-- reference, not a frozen yardstick, so it has to move when scope does.
--
-- A TRIGGER rather than code in the release path, because there are two release
-- paths — cc_approve_release (the app) and cc_tg_release (Telegram approvals) —
-- and a rule that lives in one of them is a rule that is wrong half the time.
--
-- ONLY EVER RAISES. Neither of his rules lowers an estimate, and a partial
-- release must not drag the estimate down to the tranche.
--
-- Writes to cc_budget_lines.internal_estimate_amt — the existing Trustee-set
-- slot — and never touches the imported [IB…] sheets. The import stays intact
-- and re-runnable, so this is reversible: clearing internal_estimate_amt puts
-- the original baseline back. The BPH sync only writes current_budget_amt /
-- current_wo_committed_amt / current_paid_amt, so it cannot undo this.

create or replace function public.fn_cc_ie_follow_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_released numeric;
  v_ie       numeric;
  v_ib       numeric;
  v_current  numeric;
begin
  -- Only when a release actually moved forward. approved_for_erp_amt is set
  -- exclusively at Trustee release, so any increase IS a release.
  if coalesce(new.approved_for_erp_amt, 0) <= coalesce(old.approved_for_erp_amt, 0) then
    return new;
  end if;
  -- The baseline is not a budget request; it must never re-estimate itself.
  if coalesce(new.summary_notes, '') like '[IB%' then return new; end if;
  if new.project_id is null or new.discipline_id is null or new.sub_skill_id is null then
    return new;
  end if;

  -- Everything released on this sub-category, counting each version chain once
  -- at its highest released figure — the same shape computeMoneyRollup uses, so
  -- the estimate can never disagree with the "Budget Approved in CT Hub" column.
  select coalesce(sum(t.chain_max), 0) into v_released
  from (
    select max(coalesce(w.approved_for_erp_amt, 0)) as chain_max
    from public.cc_ws_with_versions w
    where w.project_id = new.project_id
      and w.discipline_id = new.discipline_id
      and w.sub_skill_id = new.sub_skill_id
      and w.archived_at is null
      and w.status::text <> 'cancelled'
      and coalesce(w.summary_notes, '') not like '[IB%'
    group by coalesce(w.chain_anchor_id, w.id)
  ) t;

  if v_released <= 0 then return new; end if;

  -- Current estimate: a previously set figure wins, else the imported [IB…]
  -- baseline (latest version of each chain).
  select internal_estimate_amt into v_ie
  from public.cc_budget_lines
  where project_id = new.project_id
    and discipline_id = new.discipline_id
    and sub_skill_id = new.sub_skill_id
    and line_type = 'work';

  select coalesce(sum(t.amt), 0) into v_ib
  from (
    select distinct on (coalesce(w.chain_anchor_id, w.id)) coalesce(w.total_amount, 0) as amt
    from public.cc_ws_with_versions w
    where w.project_id = new.project_id
      and w.discipline_id = new.discipline_id
      and w.sub_skill_id = new.sub_skill_id
      and w.archived_at is null
      and w.status::text <> 'cancelled'
      and coalesce(w.summary_notes, '') like '[IB%'
    order by coalesce(w.chain_anchor_id, w.id), coalesce(w.version_no, 1) desc
  ) t;

  v_current := coalesce(v_ie, v_ib, 0);

  -- Rule 1 (approved above the estimate) and rule 2 (no estimate at all) are
  -- the same comparison once "no estimate" is read as zero.
  if round(v_released) > round(v_current) then
    insert into public.cc_budget_lines
      (project_id, discipline_id, sub_skill_id, line_type,
       internal_estimate_amt, internal_estimate_set_at, internal_estimate_set_by,
       internal_estimate_notes)
    values
      (new.project_id, new.discipline_id, new.sub_skill_id, 'work',
       v_released, now(), new.approved_for_erp_by,
       'Auto-updated to the approved amount on release of ' || coalesce(new.ws_code, 'a budget'))
    on conflict (project_id, discipline_id, sub_skill_id, line_type) do update
      set internal_estimate_amt    = excluded.internal_estimate_amt,
          internal_estimate_set_at = excluded.internal_estimate_set_at,
          internal_estimate_set_by = excluded.internal_estimate_set_by,
          internal_estimate_notes  = excluded.internal_estimate_notes,
          updated_at               = now();
  end if;

  return new;
end
$function$;

comment on function public.fn_cc_ie_follow_approval() is
  'Raises cc_budget_lines.internal_estimate_amt to the total released on a sub-category whenever a release exceeds the current estimate. Never lowers it. Covers both release paths (app + Telegram) by living on the table.';

drop trigger if exists trg_cc_ie_follow_approval on public.cc_working_sheets;
create trigger trg_cc_ie_follow_approval
  after update of approved_for_erp_amt on public.cc_working_sheets
  for each row
  execute function public.fn_cc_ie_follow_approval();
