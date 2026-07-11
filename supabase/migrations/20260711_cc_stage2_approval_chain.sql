-- ============================================================
-- Cost Control 3-stage chain — STAGE 2: rules + RPC + drift
-- ============================================================
-- Every working sheet, regardless of amount, now walks:
--   submitted →(Project Head)→ ph_approved →(Atm Head)→ atm_approved
--   →(Trustee)→ (partially_approved)* → approved
-- with `returned` reachable from every pending stage. Sign-offs are
-- full-sheet; money moves only at the Trustee stage via cc_approve_release.
-- Requires 20260711_cc_stage1_enum_values.sql (enum values).

-- ── 1. Project Head role: label + module permissions ──────────
insert into public.role_labels (role, label, description)
values ('project_head', 'Project Head',
        'First sign-off on Cost Control working sheets. Chain: Project Head → Atm Head → Trustee.')
on conflict (role) do update
  set label = excluded.label, description = excluded.description, is_active = true;

insert into public.role_permissions (module_slug, role, can_view, can_edit, can_admin) values
  -- edit=true: the sign-off status UPDATE runs as the user under RLS
  ('cost-control', 'project_head', true, true, false),
  ('approvals',    'project_head', true, false, false)
on conflict (role, module_slug) do nothing;

-- ── 2. Retire the old 2-tier rules; drop the dead estimate rule ─
-- Old rows are deactivated (never deleted) so rollback is one UPDATE.
update public.approval_rules set is_active = false
 where module_slug = 'cost-control'
   and doc_type = 'cc_working_sheet'
   and to_stage <> 'deadline_set';

delete from public.approval_rules
 where module_slug = 'cost-control' and doc_type = 'cc_budget_line';

-- ── 3. Seed the 3-stage chain ──────────────────────────────────
-- The matrix trigger is SOFT-mode (a transition with no active rule passes
-- for anyone with row-UPDATE access), so skip-transitions get explicit
-- admin-only BLOCKER rules — admin passes can_approve anyway, everyone
-- else is refused.
insert into public.approval_rules
  (module_slug, doc_type, from_stage, to_stage, approver_role, override_role, amount_cap_max, notes)
values
  -- Stage 1: Project Head
  ('cost-control','cc_working_sheet','submitted','ph_approved','project_head',null,null,'Stage 1/3 — Project Head signs off (any amount)'),
  ('cost-control','cc_working_sheet','submitted','returned','project_head',null,null,'Project Head returns for revision'),
  -- Stage 2: Atm Head
  ('cost-control','cc_working_sheet','ph_approved','atm_approved','head',null,null,'Stage 2/3 — Atm Head signs off (any amount)'),
  ('cost-control','cc_working_sheet','ph_approved','returned','head',null,null,'Atm Head returns for revision'),
  -- Stage 3: Trustee (releases money — tranches or full)
  ('cost-control','cc_working_sheet','atm_approved','partially_approved','founder',null,null,'Stage 3/3 — Trustee releases a tranche'),
  ('cost-control','cc_working_sheet','atm_approved','approved','founder',null,null,'Stage 3/3 — Trustee approves in full'),
  ('cost-control','cc_working_sheet','atm_approved','returned','founder',null,null,'Trustee returns for revision'),
  ('cost-control','cc_working_sheet','partially_approved','partially_approved','founder',null,null,'Trustee releases a further tranche'),
  ('cost-control','cc_working_sheet','partially_approved','approved','founder',null,null,'Trustee releases the final tranche'),
  ('cost-control','cc_working_sheet','partially_approved','returned','founder',null,null,'Trustee returns a partially released sheet'),
  -- Deadlines: Head or Trustee (was admin-only because this rule was never seeded)
  ('cost-control','cc_working_sheet','any','deadline_set','head','founder',null,'Head or Trustee set working-sheet deadlines'),
  -- BLOCKERS — keep skip-transitions in hard mode (admin-only). The matrix
  -- trigger is soft when a (from,to) pair has NO active rule, so every
  -- escalation pair gets a rule. Also closes the pre-existing hole where a
  -- crafted UPDATE could jump draft/returned straight to an approved stage.
  ('cost-control','cc_working_sheet','submitted','approved','admin',null,null,'BLOCKED: use the 3-stage chain (PH → Atm Head → Trustee)'),
  ('cost-control','cc_working_sheet','submitted','partially_approved','admin',null,null,'BLOCKED: use the 3-stage chain'),
  ('cost-control','cc_working_sheet','submitted','atm_approved','admin',null,null,'BLOCKED: Project Head must sign off first'),
  ('cost-control','cc_working_sheet','ph_approved','approved','admin',null,null,'BLOCKED: Atm Head must sign off first'),
  ('cost-control','cc_working_sheet','ph_approved','partially_approved','admin',null,null,'BLOCKED: Atm Head must sign off first'),
  ('cost-control','cc_working_sheet','draft','ph_approved','admin',null,null,'BLOCKED: drafts must be submitted first'),
  ('cost-control','cc_working_sheet','draft','atm_approved','admin',null,null,'BLOCKED: drafts must be submitted first'),
  ('cost-control','cc_working_sheet','draft','partially_approved','admin',null,null,'BLOCKED: drafts must be submitted first'),
  ('cost-control','cc_working_sheet','draft','approved','admin',null,null,'BLOCKED: drafts must be submitted first'),
  ('cost-control','cc_working_sheet','returned','ph_approved','admin',null,null,'BLOCKED: returned sheets must be resubmitted first'),
  ('cost-control','cc_working_sheet','returned','atm_approved','admin',null,null,'BLOCKED: returned sheets must be resubmitted first'),
  ('cost-control','cc_working_sheet','returned','partially_approved','admin',null,null,'BLOCKED: returned sheets must be resubmitted first'),
  ('cost-control','cc_working_sheet','returned','approved','admin',null,null,'BLOCKED: returned sheets must be resubmitted first')
on conflict do nothing;

-- Existing deadline rule: upgrade override admin → founder (admin passes
-- can_approve implicitly anyway, so this widens deadline-setting to the
-- Trustee as the plan intends).
update public.approval_rules set override_role = 'founder'
 where module_slug = 'cost-control'
   and doc_type = 'cc_working_sheet'
   and from_stage = 'any' and to_stage = 'deadline_set'
   and approver_role = 'head';

-- Explicitly (re-)activate the exact chain tuple set — covers the case
-- where a matching row already existed (deactivated by step 2 or edited
-- out-of-band) and the INSERT above no-opped on the unique index.
update public.approval_rules set is_active = true, amount_cap_max = null
 where module_slug = 'cost-control'
   and doc_type = 'cc_working_sheet'
   and (from_stage, to_stage, approver_role) in (
     ('submitted','ph_approved','project_head'), ('submitted','returned','project_head'),
     ('ph_approved','atm_approved','head'),      ('ph_approved','returned','head'),
     ('atm_approved','partially_approved','founder'), ('atm_approved','approved','founder'),
     ('atm_approved','returned','founder'),
     ('partially_approved','partially_approved','founder'),
     ('partially_approved','approved','founder'),
     ('partially_approved','returned','founder'),
     ('any','deadline_set','head'),
     ('submitted','approved','admin'), ('submitted','partially_approved','admin'),
     ('submitted','atm_approved','admin'),
     ('ph_approved','approved','admin'), ('ph_approved','partially_approved','admin'),
     ('draft','ph_approved','admin'), ('draft','atm_approved','admin'),
     ('draft','partially_approved','admin'), ('draft','approved','admin'),
     ('returned','ph_approved','admin'), ('returned','atm_approved','admin'),
     ('returned','partially_approved','admin'), ('returned','approved','admin'));

-- ── 4. Gate cc_approve_release to the Trustee stage ────────────
-- Full body from 20260611_cc_review_hardening.sql; ONE change: releases
-- now start from atm_approved (after both sign-offs), not submitted.
create or replace function public.cc_approve_release(
  p_ws_id   uuid,
  p_tranche numeric default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ws         public.cc_working_sheets%rowtype;
  v_total      numeric;
  v_already    numeric;
  v_remaining  numeric;
  v_tranche    numeric;
  v_cumulative numeric;
  v_full       boolean;
  v_from       text;
  v_to         text;
  v_bl_id      uuid;
  v_now        timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws_id for update;
  if not found then
    raise exception 'Working Sheet not found';
  end if;
  if v_ws.status::text not in ('atm_approved','partially_approved') then
    raise exception 'Only sheets signed off by the Atm Head (or already partially released) can be released into ERP';
  end if;
  if v_ws.engineer_id = auth.uid() and not public.fn_cc_is_admin(auth.uid()) then
    raise exception 'You cannot approve a sheet you raised yourself';
  end if;

  v_total     := round(coalesce(v_ws.total_amount, 0)::numeric, 2);
  v_already   := round(coalesce(v_ws.approved_for_erp_amt, 0)::numeric, 2);
  v_remaining := v_total - v_already;
  v_tranche   := round(coalesce(p_tranche, v_remaining)::numeric, 2);

  if v_tranche <= 0 then
    raise exception 'Release amount must be greater than zero';
  end if;
  if v_tranche > v_remaining + 0.5 then
    raise exception 'Release amount (%) exceeds the remaining amount (%)', v_tranche, v_remaining;
  end if;
  if v_tranche > v_remaining then
    v_tranche := v_remaining;
  end if;

  v_cumulative := round(v_already + v_tranche, 2);
  v_full       := v_cumulative >= v_total - 0.5;
  if v_full then
    -- Snap to the exact total so nothing is left "unreleasable" and the
    -- ledger (sum of release events) ties to the sheet total.
    v_tranche    := round(v_total - v_already, 2);
    v_cumulative := v_total;
  end if;

  v_from := v_ws.status::text;
  v_to   := case when v_full then 'approved' else 'partially_approved' end;

  if not public.can_approve('cost-control', 'cc_working_sheet', v_from, v_to, v_tranche) then
    raise exception 'Your role cannot approve a release of this amount. Check /admin/approvals.';
  end if;

  update public.cc_working_sheets set
    status               = v_to::cc_ws_status,
    approved_for_erp_amt = v_cumulative,
    approved_for_erp_at  = v_now,
    approved_for_erp_by  = auth.uid(),
    approved_at          = case when v_full then v_now else approved_at end,
    approved_by          = case when v_full then auth.uid() else approved_by end
  where id = p_ws_id;

  select id into v_bl_id from public.cc_budget_lines
  where project_id = v_ws.project_id
    and discipline_id = v_ws.discipline_id
    and sub_skill_id = v_ws.sub_skill_id
    and line_type = v_ws.line_type
  limit 1;

  insert into public.cc_budget_events(
    budget_line_id, project_id, event_type, delta_amount, related_ws_id,
    remarks, requested_by, approved_by, approval_status
  ) values (
    v_bl_id, v_ws.project_id, 'ws_approved', v_tranche, p_ws_id,
    case when v_full
      then 'WS fully approved — final release Rs ' || v_tranche || ' (awaiting IN4 entry)'
      else 'WS release approved Rs ' || v_tranche || ' (cumulative Rs ' || v_cumulative || ' of Rs ' || v_total || ' · awaiting IN4 entry)'
    end,
    auth.uid(), auth.uid(), 'approved'
  );

  return jsonb_build_object(
    'ok', true,
    'new_status', v_to,
    'approved_so_far', v_cumulative,
    'released', v_tranche
  );
end $$;

grant execute on function public.cc_approve_release(uuid, numeric) to authenticated;

-- ── 5. Drift fixes (idempotent) ────────────────────────────────
-- Columns written by code / prod but never created by a repo migration.
alter table public.cc_project_disciplines
  add column if not exists estimation_mode text
    check (estimation_mode is null or estimation_mode in ('detailed','thumbrule')),
  add column if not exists thumbrule_rate_per_sft numeric,
  add column if not exists thumbrule_notes text;

alter table public.cc_working_sheets
  add column if not exists approved_for_erp_at timestamptz,
  add column if not exists approved_for_erp_by uuid references public.profiles(id) on delete set null;
