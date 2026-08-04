-- Email-health readout for the admin Notifications page. Admin / portal-owner
-- only. Returns last-7-day status counts, the current stuck-pending count, and
-- the most recent failed/dead deliveries (who, subject, attempts, error).
create or replace function public.email_delivery_health()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_ok boolean; v_counts jsonb; v_stuck int; v_recent jsonb;
begin
  select (role::text = 'admin' or coalesce(is_portal_owner, false)) into v_ok
    from public.profiles where id = auth.uid();
  if not coalesce(v_ok, false) then raise exception 'admin only'; end if;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_counts
  from (
    select status, count(*)::int as n
    from public.notification_deliveries
    where channel = 'email' and created_at > now() - interval '7 days'
    group by status
  ) s;

  select count(*)::int into v_stuck
  from public.notification_deliveries
  where channel = 'email' and status = 'pending'
    and coalesce(dispatched_at, created_at) < now() - interval '15 minutes';

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_recent
  from (
    select jsonb_build_object(
      'to', coalesce(p.full_name, p.name, p.email, '—'),
      'subject', n.title,
      'status', d.status,
      'attempts', d.attempts,
      'error', d.error,
      'at', to_char(d.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')
    ) as x
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    left join public.profiles p on p.id = n.user_id
    where d.channel = 'email' and d.status in ('failed','dead')
    order by d.created_at desc
    limit 15
  ) t;

  return jsonb_build_object('counts', v_counts, 'stuck', v_stuck, 'recent', v_recent);
end
$function$;

grant execute on function public.email_delivery_health() to authenticated;
