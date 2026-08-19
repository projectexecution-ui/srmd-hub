-- Four bugs found by testing the request flow properly, all runtime-only —
-- every one of them typechecked and built clean.
--
-- 1 · The number series refused 'req'.
--     fn_wh_next_no('req') inserts into wh_number_series, whose register column
--     had a CHECK listing only the four registers that existed before requests.
--     The function knew about 'req'; the constraint did not. So EVERY attempt to
--     raise a request failed at the very first step, which is exactly what Aksha
--     hit. Widened rather than dropped — the CHECK is what stops a typo opening a
--     fifth series nobody reads.
alter table wh_number_series drop constraint if exists wh_number_series_register_check;
alter table wh_number_series add constraint wh_number_series_register_check
  check (register = any (array['in','out','move','count','req']));

-- 2 · `stages_done <= stages_needed` broke the SECOND approval.
--     That was the dial's invariant, and the dial is gone. Under the matrix the
--     number of stages is not knowable when a request is raised — it depends on
--     which hops get taken, and a hop can be added or removed while the request
--     is in flight. With stages_needed fixed at 1, pending → checked worked and
--     checked → approved raised a check violation. stages_done survives as what
--     it is: how many approvals have been stamped, 0-2, bounded by its own CHECK.
alter table wh_requests drop constraint if exists wh_req_stages_sane;

comment on column wh_requests.stages_needed is
  'Vestigial. 1 = approval applied when this was raised, 0 = it went straight to the store. The MATRIX decides what is actually required — see approval_rules.';
comment on column wh_requests.stages_done is
  'How many approvals have been stamped on this request (0-2), pairing with approved1_* and approved2_*.';

-- 3 · The amount cap was enforced in the app but NOT in the database.
--     enforce_approval_via_matrix() derives its amount from the DIFFERENCE
--     between old and new in the amount column — right for a Cost Control sheet
--     whose amount changes as it is approved. A request's est_value never changes
--     on a status move, so the diff is 0, nullif() makes it NULL, and
--     can_approve()'s cap clause short-circuits true. Role was checked; "up to
--     two lakh" was not.
--
--     Rather than alter shared infrastructure Cost Control depends on, this is a
--     warehouse-only guard checking the cap against the ABSOLUTE value. It only
--     ever adds a refusal, and it lets admin through exactly as can_approve does
--     so the two never disagree.
create or replace function public.fn_wh_request_cap_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role   text;
  v_amount numeric := new.est_value;
begin
  if auth.uid() is null then return new; end if;
  if old.status is null or new.status is null or old.status = new.status then return new; end if;
  if v_amount is null then return new; end if;

  v_role := public.effective_user_role(auth.uid(), 'warehouse')::text;
  if v_role = 'admin' then return new; end if;

  if exists (
    select 1 from public.approval_rules ar
    where ar.is_active and ar.module_slug = 'warehouse' and ar.doc_type = 'wh_request'
      and ar.from_stage = old.status and ar.to_stage = new.status
      and (v_role = ar.approver_role or v_role = ar.override_role)
      and (ar.amount_cap_max is null or v_amount <= ar.amount_cap_max)
  ) then
    return new;
  end if;

  if exists (
    select 1 from public.approval_rules ar
    where ar.is_active and ar.module_slug = 'warehouse' and ar.doc_type = 'wh_request'
      and ar.from_stage = old.status and ar.to_stage = new.status
      and (v_role = ar.approver_role or v_role = ar.override_role)
      and ar.amount_cap_max is not null and v_amount > ar.amount_cap_max
  ) then
    raise exception
      'Not authorised: % is worth %, over the limit your approval may release. The next stage in the chain has to take it. (Set in Approvals.)',
      new.req_no, v_amount;
  end if;

  return new;
end $$;

drop trigger if exists wh_requests_cap_guard on wh_requests;
create trigger wh_requests_cap_guard
  before update on wh_requests
  for each row
  execute function public.fn_wh_request_cap_guard();

-- 4 · (code, not schema) effective_user_role takes TWO arguments and was being
--     called with one; the role came back null and movesFor() then offered nobody
--     any move, so the approval screen had no buttons and no explanation. And
--     moveRequest gated on 'edit', which locked out the Trustee named as the
--     second approver — founder is view-only on this module by design. Both fixed
--     in lib/warehouse/request-data.ts and app/(app)/warehouse/request-actions.ts.
