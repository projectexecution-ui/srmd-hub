-- Budget vs Actual report: switch from the flat SQL (cc_budget_lines) card to
-- the Budget vs Actual V2 TREE. The tree is composed in TypeScript by
-- composeBudgetV2 (over the 3 source blobs + the V2 mapping tables) — far too
-- much matching/aliasing logic to mirror in SQL, and it would drift from the
-- live /budget-vs-actual-v2 page. So the report card is now built in the route
-- (lib/budget-v2-report.ts) and this RPC is a thin, confidentiality-gated
-- fan-out: it takes the pre-built card + text and calls notify_user() for every
-- Cost Control management/reviewer recipient. Service-role only.

-- Drop the old signature (SQL-built card).
drop function if exists public.cc_budget_vs_actual_report(uuid);

create or replace function public.cc_budget_vs_actual_report(
  p_title      text,
  p_body       text,
  p_card_spec  jsonb,
  p_report_text text,
  p_only_user  uuid default null
) returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_sent int := 0; r record;
begin
  for r in
    select p.id from public.profiles p
    where p.is_active = true
      and (
        public.effective_user_role(p.id, 'cost-control')::text in ('admin','coordinator')
        or exists (select 1 from public.approval_rules ar
          where ar.module_slug = 'cost-control' and ar.doc_type = 'cc_working_sheet' and ar.is_active = true
            and (ar.approver_role = public.effective_user_role(p.id,'cost-control')::text
              or ar.override_role = public.effective_user_role(p.id,'cost-control')::text))
      )
      and (p_only_user is null or p.id = p_only_user)
  loop
    perform public.notify_user(r.id, 'cc_budget_vs_actual_report', p_title, p_body, '/cost-control',
      'cost-control', 'projects', null, jsonb_build_object('card_spec', p_card_spec, 'report_text', p_report_text));
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end
$function$;

revoke all on function public.cc_budget_vs_actual_report(text,text,jsonb,text,uuid) from public, anon, authenticated;
grant  execute on function public.cc_budget_vs_actual_report(text,text,jsonb,text,uuid) to service_role;
