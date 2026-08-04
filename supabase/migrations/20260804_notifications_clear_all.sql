-- "Clear all" for the notification bell. Bells accumulate over time and the
-- rows are just pointers (the real work lives in My Approvals / the modules),
-- so every user gets a one-tap way to empty their own bell. There is no DELETE
-- RLS policy on notifications (only SELECT/UPDATE own), so this SECURITY DEFINER
-- function is the controlled path — it can only ever delete the CALLER's own
-- rows (user_id = auth.uid()). Deliveries cascade with the notification row.
create or replace function public.notifications_clear_all()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  with del as (
    delete from public.notifications where user_id = auth.uid() returning 1
  )
  select count(*) into v_n from del;
  return v_n;
end
$function$;

grant execute on function public.notifications_clear_all() to authenticated;
