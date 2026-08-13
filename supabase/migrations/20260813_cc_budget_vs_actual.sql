-- Weekly portfolio "Budget vs Actual" report to management, as a Telegram card.
-- Per-project ERP budget vs actual paid + % used (+ ₹/sft), from cc_budget_lines
-- (root-vs-sub deduped exactly like the Cost Control home page). Skips
-- un-budgeted projects. Management / CC-reviewer recipients only (confidential).
-- Service-role only (the cron + the admin preview both call via the service
-- client). Delivered via notify_user with a card_spec + report_text on p_data.

-- Compact Indian ₹ for cards: ₹4.62 Cr / ₹8.8 L / ₹78,900.
create or replace function public.fn_inr_short(v numeric)
 returns text language sql immutable
as $function$
  select case
    when coalesce(v, 0) = 0 then '₹0'
    when abs(v) >= 1e7 then '₹' || regexp_replace(to_char(v/1e7, 'FM999990.00'), '\.?0+$', '') || ' Cr'
    when abs(v) >= 1e5 then '₹' || regexp_replace(to_char(v/1e5, 'FM999990.0'), '\.?0+$', '') || ' L'
    else public.fn_inr(v)
  end
$function$;

create or replace function public.cc_budget_vs_actual_report(p_only_user uuid default null)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_spec jsonb; v_rows jsonb; v_banner jsonb := null; v_reporttext text;
  v_title text; v_body text;
  v_cnt int; v_tot_budget numeric; v_tot_wo numeric; v_tot_paid numeric; v_pct int;
  v_bph_age int; v_sent int := 0; r record;
begin
  create temp table _pp on commit drop as
  with disc as (
    select bl.project_id, bl.discipline_id,
      bool_or(bl.sub_skill_id is not null and (coalesce(bl.current_budget_amt,0)+coalesce(bl.current_wo_committed_amt,0)+coalesce(bl.current_paid_amt,0)) > 0) as has_sub,
      sum(coalesce(bl.current_budget_amt,0))       filter (where bl.sub_skill_id is not null) as sub_b,
      sum(coalesce(bl.current_wo_committed_amt,0)) filter (where bl.sub_skill_id is not null) as sub_w,
      sum(coalesce(bl.current_paid_amt,0))         filter (where bl.sub_skill_id is not null) as sub_p,
      sum(coalesce(bl.current_budget_amt,0))       filter (where bl.sub_skill_id is null)     as root_b,
      sum(coalesce(bl.current_wo_committed_amt,0)) filter (where bl.sub_skill_id is null)     as root_w,
      sum(coalesce(bl.current_paid_amt,0))         filter (where bl.sub_skill_id is null)     as root_p
    from public.cc_budget_lines bl group by bl.project_id, bl.discipline_id
  ), pp as (
    select project_id,
      sum(case when has_sub then sub_b else root_b end) as budget,
      sum(case when has_sub then sub_w else root_w end) as wo,
      sum(case when has_sub then sub_p else root_p end) as paid
    from disc group by project_id
  )
  select pr.code, pr.name, coalesce(pr.built_up_sft,0) as sft, pp.budget, pp.wo, pp.paid,
    case when pp.budget > 0 then round(pp.paid/pp.budget*100)::int else 0 end as pct
  from public.projects pr
  join pp on pp.project_id = pr.id
  where pr.archived_at is null and pr.cc_status is not null
    and pr.cc_status::text in ('active','on_hold','completed')
    and coalesce(pp.budget,0) > 0;

  select count(*), coalesce(sum(budget),0), coalesce(sum(wo),0), coalesce(sum(paid),0)
    into v_cnt, v_tot_budget, v_tot_wo, v_tot_paid from _pp;
  if v_cnt = 0 then return 0; end if;
  v_pct := case when v_tot_budget > 0 then round(v_tot_paid/v_tot_budget*100)::int else 0 end;

  select jsonb_agg(jsonb_build_object(
    'main', case when lower(trim(code)) = lower(trim(name)) then code else code || ' · ' || left(name, 22) end,
    'sub',  'Budget ' || public.fn_inr_short(budget)
            || case when wo > 0 then ' · WO ' || public.fn_inr_short(wo) else '' end
            || case when sft > 0 and budget > 0 then ' · ' || public.fn_inr(round(budget/sft)) || '/sft' else '' end,
    'right', (case when paid > 0 then public.fn_inr_short(paid) else '—' end) || ' · ' || pct || '%',
    'rightTone', case when pct >= 95 then 'danger' when pct >= 80 then 'warn' else 'ok' end
  ) order by budget desc) into v_rows from _pp;

  select (now()::date - max(last_pulled_at)::date) into v_bph_age from public.cc_bph_project_links;
  if v_bph_age is null or v_bph_age >= 7 then
    v_banner := jsonb_build_object(
      'text', 'ERP figures ' || coalesce('are ' || v_bph_age || ' days old', 'not yet synced') || ' — re-upload the BPH report to refresh.',
      'tone', 'warn');
  end if;

  v_title := 'Budget vs Actual — ' || v_cnt || ' projects';
  v_body := v_cnt || ' projects · Budget ' || public.fn_inr_short(v_tot_budget) || ' · Paid ' || public.fn_inr_short(v_tot_paid) || ' (' || v_pct || '% used).';

  v_reporttext := v_body || chr(10) || chr(10) || (
    select string_agg('- ' || (case when lower(trim(code)) = lower(trim(name)) then code else code || ' · ' || left(name, 22) end)
                       || ' · Budget ' || public.fn_inr_short(budget) || ' · Paid ' || public.fn_inr_short(paid) || ' (' || pct || '%)',
                       chr(10) order by budget desc)
    from _pp);

  v_spec := jsonb_build_object(
    'brand', 'Budget vs Actual',
    'title', 'Budget vs Actual — portfolio',
    'subtitle', 'Confidential · management',
    'stats', jsonb_build_array(
      jsonb_build_object('label','Budget (ERP)','value', public.fn_inr_short(v_tot_budget), 'sub', v_cnt || ' projects', 'tone','brand'),
      jsonb_build_object('label','Paid to date','value', public.fn_inr_short(v_tot_paid), 'sub', v_pct || '% of budget used',
                         'tone', case when v_pct >= 90 then 'danger' when v_pct >= 75 then 'warn' else 'ok' end)
    ),
    'sections', jsonb_build_array(
      jsonb_build_object('heading', 'Per project · Budget vs Paid · % used', 'rows', v_rows)
      || case when v_banner is not null then jsonb_build_object('banner', v_banner) else '{}'::jsonb end
    ),
    'footer', 'CT HUB · Budget vs Actual · Confidential · management'
  );

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
    perform public.notify_user(r.id, 'cc_budget_vs_actual_report', v_title, v_body, '/cost-control',
      'cost-control', 'projects', null, jsonb_build_object('card_spec', v_spec, 'report_text', v_reporttext));
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end
$function$;

revoke all on function public.cc_budget_vs_actual_report(uuid) from public, anon, authenticated;
grant  execute on function public.cc_budget_vs_actual_report(uuid) to service_role;
