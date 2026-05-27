-- ============================================================
-- Defense-in-depth: enforce approval_rules on every module via a
-- BEFORE UPDATE trigger that calls public.can_approve().
--
-- "Soft mode": if no matching rule exists for this transition we let
-- the UPDATE through so behaviour is unchanged where the matrix isn't
-- configured yet. Once an admin adds a rule, that transition becomes
-- enforced everywhere — even direct UPDATEs from the UI.
--
-- Bypasses:
--   - auth.uid() is null (service_role, backfills, migrations)
--   - status column unchanged
-- ============================================================

create or replace function public.enforce_approval_via_matrix()
returns trigger
language plpgsql
security definer
as $$
declare
  v_module      text := tg_argv[0];
  v_doc_type    text := tg_argv[1];
  v_status_col  text := tg_argv[2];
  v_from        text;
  v_to          text;
  v_has_rule    boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_from := (to_jsonb(old) ->> v_status_col);
  v_to   := (to_jsonb(new) ->> v_status_col);

  if v_from is null or v_to is null or v_from = v_to then
    return new;
  end if;

  select exists (
    select 1 from public.approval_rules ar
    where ar.is_active
      and ar.module_slug = v_module
      and ar.doc_type    = v_doc_type
      and ar.from_stage  = v_from
      and ar.to_stage    = v_to
  ) into v_has_rule;

  if not v_has_rule then
    return new;  -- Soft mode: not configured → no change in behaviour.
  end if;

  if public.can_approve(v_module, v_doc_type, v_from, v_to) then
    return new;
  end if;

  raise exception
    'Not authorised: you cannot move % from % to % (configured by an admin in Approvals)',
    v_doc_type, v_from, v_to;
end $$;

drop trigger if exists trg_indents_matrix on public.indents;
create trigger trg_indents_matrix
  before update of stage on public.indents
  for each row
  execute function public.enforce_approval_via_matrix('indents', 'indent', 'stage');

drop trigger if exists trg_jmr_entries_matrix on public.jmr_daily_entries;
create trigger trg_jmr_entries_matrix
  before update of status on public.jmr_daily_entries
  for each row
  execute function public.enforce_approval_via_matrix('jmr', 'jmr_entry', 'status');

drop trigger if exists trg_jmr_bills_matrix on public.jmr_bills;
create trigger trg_jmr_bills_matrix
  before update of status on public.jmr_bills
  for each row
  execute function public.enforce_approval_via_matrix('jmr-bills', 'jmr_bill', 'status');

drop trigger if exists trg_cc_working_sheets_matrix on public.cc_working_sheets;
create trigger trg_cc_working_sheets_matrix
  before update of status on public.cc_working_sheets
  for each row
  execute function public.enforce_approval_via_matrix('cost-control', 'cc_working_sheet', 'status');

-- Inventory already gates inside its RPCs — adding the trigger is
-- belt-and-braces against anyone bypassing the RPC with a raw UPDATE.
drop trigger if exists trg_inv_requests_matrix on public.inv_requests;
create trigger trg_inv_requests_matrix
  before update of status on public.inv_requests
  for each row
  execute function public.enforce_approval_via_matrix('inventory', 'inv_request', 'status');
