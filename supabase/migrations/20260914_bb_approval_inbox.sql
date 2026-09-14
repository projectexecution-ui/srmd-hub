-- Bills waiting on you show up in My Approvals.
--
-- Aksha, 14 Sep 2026: "the Bills Approval should come with MY Approvals page as
-- well - as the Approver will go directly there and approve na - does it make
-- sense". It does, and the module checklist in AGENTS.md says so in as many
-- words: a module with an approve flow surfaces its items through
-- my_approval_inbox(). Bills Approval skipped that step.
--
-- Until now this function had exactly ONE source — Cost Control working sheets
-- — so "My Approvals" was a Cost Control inbox wearing a general name. An Atm
-- Head with a bill to sanction saw an empty page and had to know to go looking
-- inside a section he may never have opened.
--
-- It is worth more than one screen. The same function feeds four surfaces:
--
--   /approvals              My Approvals
--   /dashboard              the "needs you" count
--   app/(app)/layout.tsx    the yellow per-project counts in the left pane
--   lib/revamp/approval-counts.ts
--
-- so one branch here lights up all four.
--
-- Two deliberate choices:
--
-- · Membership comes from bb_stage_members, NOT from approval_rules. Bills
--   Approval routes on desks — who sits at ERP entry, Site Head, Civil, MEP,
--   CT Head, Billing — and adding a second, parallel source of truth for the
--   same question is how the two quietly disagree.
--
-- · on_hold and rejected are left out. "Waiting on your action" is the whole
--   promise of this screen; a parked bill is not waiting on anybody, and it is
--   still visible inside the section.
--
-- The CC branch below is unchanged, byte for byte.

create or replace function public.my_approval_inbox()
returns table(module_slug text, doc_type text, doc_table text, doc_id uuid, doc_no text, doc_url text, from_stage text, next_stage text, project_id uuid, project_code text, project_name text, doc_date date, created_at timestamp with time zone, amount numeric, urgency text, work_label text, raised_by text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select role::text as default_role from public.profiles where id = auth.uid()
  ),
  my_rules as (
    select ar.module_slug, ar.doc_type, ar.from_stage, ar.to_stage
    from public.approval_rules ar
    where ar.is_active
      and not ar.is_blocking
      and (
        (select default_role from me) = 'admin'
        or public.effective_user_role(auth.uid(), ar.module_slug)::text
             in (ar.approver_role, coalesce(ar.override_role, ''))
      )
  ),
  disabled as (
    select slug from public.module_visibility where not enabled
  ),
  inbox (module_slug, doc_type, doc_table, doc_id, doc_no, doc_url, from_stage, next_stage,
         project_id, project_code, project_name, doc_date, created_at, amount, urgency,
         work_label, raised_by) as (
    select
      'cost-control','cc_working_sheet','cc_working_sheets',
      ws.id, coalesce(ws.ws_code, '#' || substring(ws.id::text, 1, 8)),
      public.fn_cc_ws_approval_url(ws.project_id, ws.discipline_id, ws.sub_skill_id, ws.id),
      ws.status::text,
      (select to_stage from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text limit 1),
      ws.project_id, p.code, p.name,
      coalesce(ws.submitted_at::date, ws.created_at::date), ws.created_at,
      coalesce(ws.total_amount, ws.summary_total), null::text,
      coalesce(ss.name, dis.name), coalesce(eng.full_name, eng.name)
    from public.cc_working_sheets ws
    left join public.projects p on p.id = ws.project_id
    left join public.cc_sub_skills ss on ss.id = ws.sub_skill_id
    left join public.cc_disciplines dis on dis.id = ws.discipline_id
    left join public.profiles eng on eng.id = ws.engineer_id
    where ws.status::text <> 'draft'
      and ws.archived_at is null
      and exists (select 1 from my_rules m where m.module_slug='cost-control' and m.doc_type='cc_working_sheet' and m.from_stage = ws.status::text)
      and (
        (select default_role from me) = 'admin'
        or exists (
          select 1 from public.cc_project_approvers cpa
          where cpa.project_id = ws.project_id
            and cpa.user_id = auth.uid()
            and cpa.role = case ws.status::text
                 when 'submitted'          then 'project_head'
                 when 'ph_approved'        then 'head'
                 when 'atm_approved'       then 'founder'
                 when 'partially_approved' then 'founder'
                 else null end
        )
        or exists (
          select 1 from public.cc_discipline_approvers da
          where da.discipline_id = ws.discipline_id
            and da.approver_user_id = auth.uid()
            and da.is_active
        )
        or not exists (
          select 1 from public.cc_project_approvers cpa2
          where cpa2.project_id = ws.project_id
            and cpa2.role = case ws.status::text
                 when 'submitted'          then 'project_head'
                 when 'ph_approved'        then 'head'
                 when 'atm_approved'       then 'founder'
                 when 'partially_approved' then 'founder'
                 else null end
        )
      )

    union all

    -- ── Bills Approval ────────────────────────────────────────────────────
    select
      'bills-booking','bb_bill','bb_bills',
      b.id,
      coalesce(nullif(btrim(b.bill_no), ''), nullif(btrim(b.ra_no), ''), '#' || substring(b.id::text, 1, 8)),
      '/bills-booking/' || b.id::text,
      b.current_stage::text,
      -- Left null on purpose: the forward target is decided by PIPELINE in
      -- lib/bills-booking/stages.ts, and a copy of that order in SQL is a
      -- second source of truth waiting to drift. The page reads the verb from
      -- the stage it IS at (lib/approvals/inbox-action.ts).
      null::text,
      b.project_id, p.code,
      -- A bill can have no CT Hub project — 32 of the 54 IN4 sub-projects with
      -- work orders have none. Name the building we do know rather than
      -- showing a blank row nobody can place.
      coalesce(p.name, d.short_name, sp.name, d.in4_name),
      b.bill_date,
      -- The inbox measures how long something has been WAITING on you, so the
      -- clock is when it arrived at this desk, not when the bill was raised.
      b.stage_since,
      coalesce(b.net_amount, b.claimed_amount),
      null::text,
      coalesce(nullif(btrim(b.work), ''), b.discipline),
      coalesce(raiser.full_name, raiser.name, b.vendor_text)
    from public.bb_bills b
    left join public.projects p on p.id = b.project_id
    left join public.bb_project_desks d on d.subproject_id = b.in4_subproject_id
    left join public.in4_subprojects sp on sp.id = b.in4_subproject_id
    left join public.profiles raiser on raiser.id = b.created_by
    where b.current_stage not in ('paid','rejected','on_hold')
      and (
        (select default_role from me) = 'admin'
        or auth.uid() in (
          select public.bb_stage_members(b.current_stage, b.project_id, b.discipline, b.in4_subproject_id)
        )
      )
  )
  select inbox.module_slug, inbox.doc_type, inbox.doc_table, inbox.doc_id, inbox.doc_no, inbox.doc_url,
         inbox.from_stage, inbox.next_stage, inbox.project_id, inbox.project_code, inbox.project_name,
         inbox.doc_date, inbox.created_at, inbox.amount, inbox.urgency, inbox.work_label, inbox.raised_by
  from inbox
  where inbox.module_slug not in (select slug from disabled)
  order by inbox.doc_date desc nulls last, inbox.created_at desc
$function$;
