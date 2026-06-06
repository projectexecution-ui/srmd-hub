-- ============================================================
-- approval_rule_stats: how long historically a (module, transition)
-- has taken — used by the Smart Blueprint admin matrix to suggest
-- SLA thresholds without admins having to guess.
-- ============================================================

create or replace view public.approval_rule_stats as
with ordered as (
  select
    ae.module_slug, ae.doc_type, ae.doc_id, ae.from_stage, ae.to_stage,
    ae.created_at as transition_at,
    coalesce(
      lag(ae.created_at) over (
        partition by ae.module_slug, ae.doc_id
        order by ae.created_at
      ),
      ae.created_at
    ) as entered_from_stage_at
  from public.approval_events ae
)
select
  module_slug, doc_type, from_stage, to_stage,
  count(*)::int as sample_count,
  round(percentile_cont(0.5) within group (
    order by extract(epoch from (transition_at - entered_from_stage_at)) / 3600.0
  ))::int as p50_hours,
  round(percentile_cont(0.9) within group (
    order by extract(epoch from (transition_at - entered_from_stage_at)) / 3600.0
  ))::int as p90_hours,
  round(max(extract(epoch from (transition_at - entered_from_stage_at)) / 3600.0))::int
    as max_hours
from ordered
group by module_slug, doc_type, from_stage, to_stage;

comment on view public.approval_rule_stats is
  'Per-(module, transition) historical dwell-time stats derived from approval_events. Used by the Smart Blueprint admin matrix to suggest SLA thresholds (typically P90).';
