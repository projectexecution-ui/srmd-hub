-- Smart daily digest for engineers on Internal Estimate. Sends ONLY to an
-- engineer who has something to act on (a returned sheet to fix, or a draft not
-- yet sent); awaiting-approval is shown as context but never triggers a nag on
-- its own. Skips inactive users / anyone who lost CC access. Rides notify_user
-- (respects each engineer's notification preferences). p_only_user restricts to
-- one engineer (for a manual "send me a test").
create or replace function public.cc_engineer_digests(p_only_user uuid default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; n int := 0; v_data jsonb; v_title text; v_body text;
begin
  for r in
    select ws.engineer_id as user_id,
      count(*) filter (where ws.status::text = 'returned')::int as returned_cnt,
      count(*) filter (where ws.status::text = 'draft')::int as draft_cnt,
      count(*) filter (where ws.status::text in ('submitted','ph_approved','atm_approved'))::int as awaiting_cnt,
      coalesce(sum(coalesce(ws.total_amount,0)) filter (where ws.status::text in ('submitted','ph_approved','atm_approved')), 0) as awaiting_amt,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'label', coalesce(pj.code,'') || ' · ' || coalesce(ss.name, ws.ws_code),
          'reason', left(coalesce(ws.return_reason,''), 140)
        ) order by ws.returned_at desc nulls last
      ) filter (where ws.status::text = 'returned'), '[]'::jsonb) as returned_items,
      coalesce(jsonb_agg(
        jsonb_build_object('label', coalesce(pj.code,'') || ' · ' || coalesce(ss.name, ws.ws_code))
        order by ws.created_at desc
      ) filter (where ws.status::text = 'draft'), '[]'::jsonb) as draft_items,
      coalesce(max(case when ws.status::text in ('submitted','ph_approved','atm_approved') and ws.submitted_at is not null
                        then greatest(extract(day from now() - ws.submitted_at)::int, 0) else 0 end), 0) as oldest_awaiting_days
    from public.cc_working_sheets ws
    left join public.projects pj on pj.id = ws.project_id
    left join public.cc_sub_skills ss on ss.id = ws.sub_skill_id
    where coalesce(ws.summary_notes,'') not like '[IB%'
      and ws.archived_at is null
      and ws.engineer_id is not null
      and ws.status::text in ('returned','draft','submitted','ph_approved','atm_approved')
      and (p_only_user is null or ws.engineer_id = p_only_user)
    group by ws.engineer_id
  loop
    -- Smart: only nag when there's something to DO (returned / draft).
    if r.returned_cnt = 0 and r.draft_cnt = 0 then continue; end if;
    -- Only active users who still have Internal Estimate access.
    if not exists (select 1 from public.profiles pr where pr.id = r.user_id and pr.is_active) then continue; end if;
    if not public.fn_cc_can_edit(r.user_id) then continue; end if;

    v_title := 'Your budget requests — ' ||
      case
        when r.returned_cnt > 0 then r.returned_cnt || ' returned to fix'
        else r.draft_cnt || ' draft' || case when r.draft_cnt = 1 then '' else 's' end || ' to send'
      end;

    v_body :=
      case when r.returned_cnt > 0 then r.returned_cnt || ' returned to you (fix & resend). ' else '' end ||
      case when r.draft_cnt   > 0 then r.draft_cnt || ' draft' || case when r.draft_cnt = 1 then '' else 's' end || ' not sent. ' else '' end ||
      case when r.awaiting_cnt > 0 then r.awaiting_cnt || ' awaiting approval.' else '' end;

    v_data := jsonb_build_object(
      'returned', r.returned_cnt,
      'drafts', r.draft_cnt,
      'awaiting', r.awaiting_cnt,
      'awaiting_amount', round(r.awaiting_amt),
      'oldest_awaiting_days', r.oldest_awaiting_days,
      'returned_items', (select jsonb_agg(e) from (select e from jsonb_array_elements(r.returned_items) e limit 5) s),
      'draft_items',   (select jsonb_agg(e) from (select e from jsonb_array_elements(r.draft_items) e limit 5) s)
    );

    perform public.notify_user(
      r.user_id, 'cc_engineer_digest', v_title, v_body,
      '/cost-control', 'cost-control', 'cc_working_sheets', null, v_data
    );
    n := n + 1;
  end loop;
  return n;
end $function$;
