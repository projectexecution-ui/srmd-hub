-- ============================================================
-- blueprint_demo_sla_inbox(): every non-terminal demo request,
-- joined to its outgoing approval_rule(s) for SLA threshold +
-- approval_rule_stats for auto-derived P90. Computes hours_in_status
-- and breach state.
-- Once the demo pattern is proven, Phase 2 renames this to
-- `sla_inbox()` and UNIONs the other 4 modules into the same RPC.
-- ============================================================

drop function if exists public.blueprint_demo_sla_inbox();
create or replace function public.blueprint_demo_sla_inbox()
returns table (
  module_slug         text,
  doc_table           text,
  doc_id              uuid,
  doc_no              text,
  title               text,
  current_status      text,
  next_stage          text,
  entered_status_at   timestamptz,
  hours_in_status     numeric,
  sla_hours           int,
  sla_source          text,
  breach              boolean,
  breach_severity     text,
  project_code        text,
  project_name        text,
  amount              numeric,
  approver_role       text
)
language sql stable security definer
set search_path = public
as $$
  with active as (
    select
      r.id            as doc_id,
      r.request_no    as doc_no,
      r.title,
      r.status::text  as current_status,
      r.project_id,
      r.amount,
      coalesce(
        (select max(l.created_at)
         from public.blueprint_demo_request_status_log l
         where l.request_id = r.id and l.to_status = r.status::text),
        r.created_at
      ) as entered_status_at
    from public.blueprint_demo_requests r
    where r.status::text not in ('closed','rejected')
  ),
  rules as (
    select
      ar.module_slug, ar.doc_type, ar.from_stage, ar.to_stage,
      ar.approver_role, ar.sla_hours,
      arst.p90_hours
    from public.approval_rules ar
    left join public.approval_rule_stats arst
      on  arst.module_slug = ar.module_slug
      and arst.doc_type    = ar.doc_type
      and arst.from_stage  = ar.from_stage
      and arst.to_stage    = ar.to_stage
    where ar.is_active
      and ar.module_slug = 'blueprint-demo'
      and ar.to_stage <> 'rejected'
  ),
  expanded as (
    select
      a.doc_id, a.doc_no, a.title, a.current_status, a.entered_status_at,
      a.project_id, a.amount,
      r.to_stage as next_stage,
      r.approver_role,
      r.sla_hours,
      r.p90_hours,
      extract(epoch from (now() - a.entered_status_at)) / 3600.0 as hrs
    from active a
    join rules r on r.from_stage = a.current_status
  ),
  picked as (
    select
      e.*,
      coalesce(e.sla_hours, e.p90_hours)        as eff_sla,
      case
        when e.sla_hours is not null  then 'configured'
        when e.p90_hours is not null  then 'derived_p90'
        else null
      end as sla_source
    from expanded e
  )
  select
    'blueprint-demo' as module_slug,
    'public.blueprint_demo_requests' as doc_table,
    p.doc_id, p.doc_no, p.title, p.current_status, p.next_stage,
    p.entered_status_at,
    round(p.hrs::numeric, 1) as hours_in_status,
    p.eff_sla as sla_hours,
    p.sla_source,
    (p.eff_sla is not null and p.hrs > p.eff_sla) as breach,
    case
      when p.eff_sla is null or p.hrs <= p.eff_sla then null
      when p.hrs <= p.eff_sla * 1.5                 then 'mild'
      when p.hrs <= p.eff_sla * 3.0                 then 'overdue'
      else                                              'critical'
    end as breach_severity,
    pr.code as project_code,
    pr.name as project_name,
    p.amount,
    p.approver_role
  from picked p
  left join public.projects pr on pr.id = p.project_id
  order by
    case when (p.eff_sla is not null and p.hrs > p.eff_sla) then 0 else 1 end,
    p.hrs desc;
$$;

grant execute on function public.blueprint_demo_sla_inbox() to authenticated;
