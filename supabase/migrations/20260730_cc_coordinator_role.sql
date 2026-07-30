-- ============================================================================
-- Coordinator role — Cost Control setup/admin WITHOUT money-approval authority
-- ============================================================================
-- A "Coordinator" is a Cost Control back-office admin: create projects, manage
-- the discipline/sub-skill master, run BPH sync, set up projects (disciplines,
-- sub-skills, engineers, named approvers) and SEE everything (all sheets +
-- confidential figures) — but CANNOT approve, sign off, release, return, or
-- decide an Internal Estimate. The money block is structural, not cosmetic:
--
--   • Coordinator is deliberately NOT in approval_rules → can_approve() is
--     false for every stage → the enforce_approval_via_matrix() trigger
--     rejects any status change, through ANY path (chain action, bulk,
--     cc_approve_release). Nothing here touches that trigger or can_approve().
--   • Every approve button in the UI is matrix-driven (getWSApprovalContext →
--     callCanApprove) so they simply never render for a Coordinator.
--   • Coordinator is kept OUT of fn_cc_is_reviewer(), so it gets NO write
--     access to cc_working_sheets (the reviewer UPDATE policy) — it cannot
--     touch the released-money column even via a hand-crafted API call.
--   • Even naming itself as a project approver does nothing: can_approve()
--     checks the caller's EFFECTIVE ROLE ('coordinator', not in the matrix),
--     not cc_project_approvers.
--
-- Reviewer VISIBILITY (read all sheets + confidential money) comes from
-- fn_cc_can_edit (Coordinator has can_edit) via fn_cc_user_in_project on the
-- read policy, plus the app-level checkIsCcReviewer() returning true for the
-- role. Setup WRITES are enabled by teaching the Cost Control config policies
-- that "a Cost Control admin by permission" (fn_cc_can_admin) may act — not
-- only the hub super-admin (fn_cc_is_admin). All broadened tables are config /
-- reference / assignment data; NONE are money.
--
-- Idempotent: safe to re-run. The enum value + role_permissions + role_labels
-- rows were applied live first (ADD VALUE cannot share a txn with its use).

-- 1. The role value (additive; no-op if present) ------------------------------
alter type public.user_role add value if not exists 'coordinator';

-- 2. Permissions: full Cost Control view/edit/admin — and NOTHING elsewhere ----
insert into public.role_permissions (role, module_slug, can_view, can_edit, can_admin)
values ('coordinator', 'cost-control', true, true, true)
on conflict (role, module_slug)
  do update set can_view = excluded.can_view,
                can_edit = excluded.can_edit,
                can_admin = excluded.can_admin;

insert into public.role_labels (role, label, description)
values ('coordinator', 'Coordinator (setup)',
        'Cost Control setup & data — create projects, manage disciplines, sync BPH, full visibility. Cannot approve or release money.')
on conflict (role)
  do update set label = excluded.label, description = excluded.description;

-- 3. Config / reference WRITE policies: also allow a CC admin-by-permission ----
--    (previously hub super-admin only). Preserves each policy's existing terms
--    and only broadens them. Config data only — no money tables here.
alter policy cc_disciplines_admin_write on public.cc_disciplines
  using       (public.fn_cc_is_admin(auth.uid()) or public.fn_cc_can_admin(auth.uid()))
  with check  (public.fn_cc_is_admin(auth.uid()) or public.fn_cc_can_admin(auth.uid()));

alter policy cc_sub_skills_admin_write on public.cc_sub_skills
  using       (public.fn_cc_is_admin(auth.uid()) or public.fn_cc_can_admin(auth.uid()))
  with check  (public.fn_cc_is_admin(auth.uid()) or public.fn_cc_can_admin(auth.uid()));

alter policy pa_admin_write on public.project_assignments
  using       (public.fn_cc_is_admin(auth.uid()) or public.fn_cc_can_admin(auth.uid()))
  with check  (public.fn_cc_is_admin(auth.uid()) or public.fn_cc_can_admin(auth.uid()));

alter policy cc_proj_disc_write on public.cc_project_disciplines
  using       (public.fn_cc_is_admin(auth.uid())
               or public.fn_cc_can_admin(auth.uid())
               or exists (select 1 from public.projects p
                          where p.id = cc_project_disciplines.project_id and p.pm_user_id = auth.uid()))
  with check  (public.fn_cc_is_admin(auth.uid())
               or public.fn_cc_can_admin(auth.uid())
               or exists (select 1 from public.projects p
                          where p.id = cc_project_disciplines.project_id and p.pm_user_id = auth.uid()));

alter policy cc_proj_ss_write on public.cc_project_sub_skills
  using       (public.fn_cc_is_admin(auth.uid())
               or public.fn_cc_can_admin(auth.uid())
               or exists (select 1 from public.projects p
                          where p.id = cc_project_sub_skills.project_id and p.pm_user_id = auth.uid()))
  with check  (public.fn_cc_is_admin(auth.uid())
               or public.fn_cc_can_admin(auth.uid())
               or exists (select 1 from public.projects p
                          where p.id = cc_project_sub_skills.project_id and p.pm_user_id = auth.uid()));

-- 4. Setup-visibility SELECT policies: a CC admin sees approvers + assignments -
alter policy cc_pa_select on public.cc_project_approvers
  using (public.fn_cc_is_reviewer(auth.uid()) or public.fn_cc_can_admin(auth.uid()) or (user_id = auth.uid()));

alter policy cc_ssa_select on public.cc_subskill_assignments
  using (public.fn_cc_is_reviewer(auth.uid()) or public.fn_cc_can_admin(auth.uid()) or (engineer_id = auth.uid()));

-- 5. Setup-write RPCs: accept a CC admin-by-permission alongside reviewers -----
--    (assigning engineers / naming approvers is setup, not approval — the
--    money gate stays entirely with can_approve/the matrix trigger).
create or replace function public.cc_set_subskill_engineer(p_project uuid, p_sub_skill uuid, p_engineer uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (public.fn_cc_is_reviewer(auth.uid()) or public.fn_cc_can_admin(auth.uid())) then
    raise exception 'Only Cost Control management can assign engineers';
  end if;
  if p_engineer is null then
    delete from public.cc_subskill_assignments
      where project_id = p_project and sub_skill_id = p_sub_skill;
  else
    insert into public.cc_subskill_assignments (project_id, sub_skill_id, engineer_id, assigned_by)
      values (p_project, p_sub_skill, p_engineer, auth.uid())
    on conflict (project_id, sub_skill_id)
      do update set engineer_id = excluded.engineer_id, assigned_by = auth.uid(), assigned_at = now();
  end if;
end $function$;

create or replace function public.cc_set_project_approver(p_project uuid, p_role text, p_user uuid, p_add boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (public.fn_cc_is_reviewer(auth.uid()) or public.fn_cc_can_admin(auth.uid())) then
    raise exception 'Only Cost Control management can set project approvers';
  end if;
  if p_role not in ('project_head','head','founder') then
    raise exception 'Unknown approver role';
  end if;
  if p_add then
    insert into public.cc_project_approvers (project_id, role, user_id, assigned_by)
      values (p_project, p_role, p_user, auth.uid())
    on conflict (project_id, role, user_id) do nothing;
  else
    delete from public.cc_project_approvers
      where project_id = p_project and role = p_role and user_id = p_user;
  end if;
end $function$;
