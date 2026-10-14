-- Telegram alerts, per Aksha's picks (14 Oct 2026):
--
--   1. The sender gets everything it needs to compose the six-part text card
--      (who/why · fact · figure · next · who-when · buttons): the notification's
--      id (for the ✓ Seen button), its recipient (for the role line), its
--      structured data and doc_table. /api/telegram/send does the composing.
--   2. One message per approval: while Telegram approval CARDS are switched on
--      (cc_telegram_approvals), the plain "approval needed" text is skipped for
--      Cost Control sheets — the card already reaches the same approver.
--   3. Quiet hours: "for your record" news that fires between 21:00 and 08:00
--      IST waits until the morning (hold_until); "needs you" alerts go at once.
--      The retry sweep (email-retry cron, 09:00 / 15:00 IST) releases held rows.
--      Switch: app_settings 'telegram_quiet_hours' ('false' turns it off).
--   4. "Entered in IN4" groups rupees the Indian way (₹5,24,895, not ₹524,895).

alter table public.notification_deliveries add column if not exists hold_until timestamptz;
comment on column public.notification_deliveries.hold_until is
  'Telegram quiet hours: do not send before this moment (news between 21:00 and 08:00 IST waits for the morning).';

insert into public.app_settings(key, value) values ('telegram_quiet_hours', 'true')
on conflict (key) do nothing;

-- The same list as lib/notifications/bucket.ts NEWS_TYPES — "it happened,
-- nobody is blocked on you". Keep the two in step.
create or replace function public.notification_is_news(p_type text)
returns boolean language sql immutable as $$
  select coalesce(p_type, '') in (
    'cc_budget_approved', 'cc_estimate_approved', 'cc_ws_archived', 'access_approved',
    'bills_sanction_matched', 'in4_entered', 'in4_grn_received', 'cc_trustee_returned',
    'procurement_digest', 'cc_engineer_digest', 'cc_budget_approved_digest', 'cc_budget_vs_actual_report'
  )
$$;

create or replace function public.dispatch_telegram_delivery_now(p_delivery_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_url text; v_secret text; v_chat text; v_title text; v_body text; v_link text; v_type text;
  v_cardtext text; v_cardspec jsonb; v_channel text; v_notif uuid; v_user uuid; v_data jsonb; v_doc_table text;
  v_hold timestamptz; v_ist timestamp; v_hour int; v_quiet boolean; v_cards boolean;
begin
  select channel, notification_id, hold_until into v_channel, v_notif, v_hold
    from public.notification_deliveries where id = p_delivery_id;
  if v_channel is null or v_channel <> 'telegram' then return; end if;
  -- Still inside quiet hours: the sweep will call again when the hold passes.
  if v_hold is not null and v_hold > now() then return; end if;

  select value into v_url    from public.app_private_settings where key = 'notify_dispatch_url';
  select value into v_secret from public.app_private_settings where key = 'notify_internal_secret';
  if v_url is null or v_secret is null then
    update public.notification_deliveries set error = 'dispatch config missing', dispatched_at = now() where id = p_delivery_id;
    return;
  end if;
  v_url := replace(v_url, 'email/send', 'telegram/send');

  select n.title, n.body, n.url, n.type, n.user_id, n.data, n.doc_table,
         n.data->>'report_text', n.data->'card_spec', np.telegram_chat_id
    into v_title, v_body, v_link, v_type, v_user, v_data, v_doc_table, v_cardtext, v_cardspec, v_chat
  from public.notifications n
  left join public.notification_preferences np on np.user_id = n.user_id
  where n.id = v_notif;

  -- Group-delivered reports: not sent to personal DMs.
  if v_type = 'cc_budget_vs_actual_report' then
    update public.notification_deliveries set status = 'skipped', error = 'delivered to group instead' where id = p_delivery_id;
    return;
  end if;

  -- One message per approval: the tap-to-approve card covers it while cards are on.
  if v_type = 'approval_pending' and v_doc_table = 'cc_working_sheets' then
    select lower(coalesce(value, '')) in ('true', '1', 'on') into v_cards from public.app_settings where key = 'cc_telegram_approvals';
    if coalesce(v_cards, false) then
      update public.notification_deliveries set status = 'skipped', error = 'approval card sent instead' where id = p_delivery_id;
      return;
    end if;
  end if;

  if v_chat is null or v_chat = '' then
    update public.notification_deliveries set status = 'skipped', error = 'telegram not linked' where id = p_delivery_id;
    return;
  end if;

  -- Quiet hours: news between 21:00 and 08:00 IST waits for 08:00.
  select coalesce(lower(btrim(value, '" ')), 'true') <> 'false' into v_quiet from public.app_settings where key = 'telegram_quiet_hours';
  if coalesce(v_quiet, true) and public.notification_is_news(v_type) then
    v_ist := now() at time zone 'Asia/Kolkata';
    v_hour := extract(hour from v_ist)::int;
    if v_hour >= 21 or v_hour < 8 then
      v_hold := (date_trunc('day', v_ist) + case when v_hour >= 21 then interval '1 day 8 hours' else interval '8 hours' end) at time zone 'Asia/Kolkata';
      update public.notification_deliveries
         set status = 'pending', hold_until = v_hold, error = 'quiet hours — waits for 8 am IST'
       where id = p_delivery_id;
      return;
    end if;
  end if;

  update public.notification_deliveries
    set status = 'pending', attempts = attempts + 1, dispatched_at = now(), error = null, hold_until = null
    where id = p_delivery_id;

  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object(
                   'chatId', v_chat,
                   'title', coalesce(v_title, 'CT HUB'),
                   'text', coalesce(v_body, ''),
                   'url', v_link,
                   'type', v_type,
                   'cardText', v_cardtext,
                   'cardSpec', v_cardspec,
                   'deliveryId', p_delivery_id,
                   'notificationId', v_notif,
                   'userId', v_user,
                   'docTable', v_doc_table,
                   'data', v_data
                 ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret)
    );
  exception when others then
    update public.notification_deliveries set status = 'failed', error = left(SQLERRM, 300) where id = p_delivery_id;
  end;
end
$function$;

-- The sweep leaves held rows alone until their hold passes, then sends them
-- like any other stuck row (attempts = 0, so they are not "dead").
create or replace function public.telegram_retry_sweep()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_retried int := 0; v_dead int := 0; v_rec record;
begin
  update public.notification_deliveries
    set status = 'dead'
    where channel = 'telegram' and status in ('pending','failed') and attempts >= 5
      and (hold_until is null or hold_until <= now())
      and coalesce(dispatched_at, created_at) < now() - interval '10 minutes';
  get diagnostics v_dead = row_count;

  for v_rec in
    select id from public.notification_deliveries
    where channel = 'telegram' and status in ('pending','failed') and attempts < 5
      and (hold_until is null or hold_until <= now())
      and coalesce(dispatched_at, created_at) < now() - interval '10 minutes'
    order by created_at
    limit 200
  loop
    perform public.dispatch_telegram_delivery_now(v_rec.id);
    v_retried := v_retried + 1;
  end loop;

  return jsonb_build_object('retried', v_retried, 'dead', v_dead);
end
$function$;

-- "Entered in IN4": ₹ the Indian way. Same function as 20260804, one expression changed.
create or replace function public.cc_mark_in4_entered(p_ws_id uuid, p_ref text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ws public.cc_working_sheets%rowtype;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  v_role := coalesce(public.effective_user_role(auth.uid(), 'cost-control')::text, '');
  if not (v_role in ('billing', 'coordinator') or public.fn_cc_is_admin(auth.uid())) then
    raise exception 'Only the IN4-entry team (Billing / Coordinator) or an admin can mark IN4 entry';
  end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws_id for update;
  if not found then raise exception 'Working Sheet not found'; end if;
  if v_ws.status::text not in ('approved', 'partially_approved') then
    raise exception 'Only released sheets can be marked as entered in IN4';
  end if;
  if coalesce(v_ws.approved_for_erp_amt, 0) <= 0 then
    raise exception 'Nothing has been released on this sheet yet';
  end if;
  if v_ws.in4_entered_at is not null then
    raise exception 'This sheet is already marked as entered in IN4';
  end if;

  update public.cc_working_sheets
     set in4_entered_at = now(), in4_entered_by = auth.uid(),
         in4_ref = nullif(btrim(coalesce(p_ref, '')), '')
   where id = p_ws_id;

  begin
    declare
      v_proj text; v_sub text; v_msg text; v_r uuid; v_ref text; v_data jsonb;
    begin
      select code into v_proj from public.projects where id = v_ws.project_id;
      select name into v_sub  from public.cc_sub_skills where id = v_ws.sub_skill_id;
      v_ref := nullif(btrim(coalesce(p_ref, '')), '');
      v_msg := coalesce(v_proj, '') || ' · ' || coalesce(v_sub, v_ws.ws_code)
             || ' — the released budget (' || public.fn_inr(round(coalesce(v_ws.approved_for_erp_amt, 0))) || ')'
             || ' is now entered in IN4' || coalesce(' (ref ' || v_ref || ')', '') || '. The Work Order can now proceed.';
      v_data := jsonb_build_object(
        'project', coalesce(v_proj, ''),
        'work', coalesce(v_sub, v_ws.ws_code),
        'amount', round(coalesce(v_ws.approved_for_erp_amt, 0)),
        'ref', v_ref
      );
      for v_r in
        select unnest(array_remove(array[v_ws.engineer_id], null))
        union
        select public.cc_ph_atm_recipients(v_ws.project_id)
      loop
        perform public.notify_user(v_r, 'in4_entered', 'Entered in IN4 — ' || coalesce(v_proj, 'budget'),
          v_msg, '/cost-control/working-sheets/' || p_ws_id::text, 'cost-control', 'cc_working_sheets', p_ws_id, v_data);
      end loop;
    end;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true);
end
$function$;
