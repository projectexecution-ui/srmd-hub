-- Budget shifting: the CT Head may change the amount while approving
-- (Aksha, 10 Oct 2026: "CT head should get option to change the amount as
-- well … go ahead - up or down both allowed - for this approval dont need to
-- change").
--
--   • Up or down, never above what is free to move on the "from" line (the
--     same hard cap the raiser has — paid / WO-PO-committed money stays put).
--   • Only at the CT Head step. The Atm Head and the Trustee approve the CT
--     Head's figure as it stands, or turn it down.
--   • The raiser's figure is kept (asked_amount) and shown beside the new one;
--     the CT Head's compulsory comment says why; the raiser is told.
--   • Both lines' history gets a line saying the amount changed.
-- The AB ₹21,500 request is already past the CT Head, so nothing about it
-- changes here beyond asked_amount being filled with its own figure.

-- ── 1. The raiser's figure, kept ────────────────────────────────────────
alter table public.cc_budget_transfers add column if not exists asked_amount numeric;
update public.cc_budget_transfers set asked_amount = amount where asked_amount is null;

create or replace function public.fn_cc_bt_keep_asked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.asked_amount := coalesce(new.asked_amount, new.amount);
  return new;
end $$;

drop trigger if exists trg_cc_bt_keep_asked on public.cc_budget_transfers;
create trigger trg_cc_bt_keep_asked
  before insert on public.cc_budget_transfers
  for each row execute function public.fn_cc_bt_keep_asked();

-- ── 2. Approve, with the CT Head's amount ───────────────────────────────
-- A new argument, so the old two-argument function goes first — two
-- overloads would leave PostgREST unable to pick one.
drop function if exists public.cc_transfer_approve(uuid, text);
create function public.cc_transfer_approve(p_id uuid, p_comment text default null, p_amount numeric default null)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  t      record;
  v_next text;
  v_proj text;
  v_who  uuid;
  v_note text := nullif(btrim(p_comment), '');
  v_new  numeric := case when p_amount is null then null else round(p_amount) end;
  v_max  numeric;
  v_from_lbl text;
  v_to_lbl   text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into t from cc_budget_transfers where id = p_id for update;
  if t.id is null then raise exception 'That transfer request no longer exists'; end if;
  v_role := effective_user_role(v_uid, 'cost-control');

  if t.raised_by = v_uid and not fn_cc_is_admin(v_uid) then
    raise exception 'You raised this request, so somebody else has to approve it';
  end if;

  -- Same figure (or none sent) = no change.
  if v_new is not null and v_new = t.amount then v_new := null; end if;
  if v_new is not null and t.status <> 'pending_ph' then
    raise exception 'Only the CT Head can change the amount. Approve this figure or turn it down with a reason.';
  end if;

  if t.status = 'pending_ph' then
    if not fn_cc_transfer_is_ct_head(v_uid, t.project_id) then
      raise exception 'This is waiting for the CT Head';
    end if;
    if v_note is null then
      raise exception 'Write a comment with your approval — it is compulsory for the CT Head';
    end if;

    if v_new is not null then
      if v_new <= 0 then raise exception 'Enter an amount to move'; end if;
      -- This request is itself counted as spoken for, so add it back.
      v_max := fn_cc_transfer_free(t.project_id, t.from_discipline_id, t.from_sub_skill_id) + t.amount;
      if v_new > v_max then
        raise exception 'Only % is free to move off that line. The rest is already paid or committed on a WO/PO.', fn_inr(v_max);
      end if;
    end if;

    update cc_budget_transfers
       set status = 'pending_atm', ph_by = v_uid, ph_at = now(), ph_comment = v_note,
           amount = coalesce(v_new, amount)
     where id = p_id;
    v_next := 'pending_atm';

    if v_new is not null then
      v_from_lbl := fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id);
      v_to_lbl   := fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id);
      select coalesce(code || ' ', '') || name into v_proj from projects where id = t.project_id;

      -- Both lines' history: the figure the request now carries.
      insert into cc_budget_events (budget_line_id, project_id, event_type, delta_amount, related_budget_line_id, remarks, channel, requested_by, approval_status, event_date)
      select f.id, t.project_id, 'budget_update', 0, x.id,
             'Transfer amount changed by the CT Head — ' || fn_inr(t.amount) || ' → ' || fn_inr(v_new)
               || ' to move OUT to ' || v_to_lbl || ' · ' || v_note,
             'web', v_uid, 'pending', now()
        from cc_budget_lines f, cc_budget_lines x
       where f.project_id = t.project_id and f.discipline_id = t.from_discipline_id and f.sub_skill_id = t.from_sub_skill_id
         and x.project_id = t.project_id and x.discipline_id = t.to_discipline_id   and x.sub_skill_id = t.to_sub_skill_id
       limit 1;
      insert into cc_budget_events (budget_line_id, project_id, event_type, delta_amount, related_budget_line_id, remarks, channel, requested_by, approval_status, event_date)
      select x.id, t.project_id, 'budget_update', 0, f.id,
             'Transfer amount changed by the CT Head — ' || fn_inr(t.amount) || ' → ' || fn_inr(v_new)
               || ' to come IN from ' || v_from_lbl || ' · ' || v_note,
             'web', v_uid, 'pending', now()
        from cc_budget_lines f, cc_budget_lines x
       where f.project_id = t.project_id and f.discipline_id = t.from_discipline_id and f.sub_skill_id = t.from_sub_skill_id
         and x.project_id = t.project_id and x.discipline_id = t.to_discipline_id   and x.sub_skill_id = t.to_sub_skill_id
       limit 1;

      -- The raiser is told their figure changed, and why.
      if t.raised_by is not null and t.raised_by <> v_uid then
        perform notify_user(t.raised_by, 'cc_transfer_amount_changed',
          'Budget shift changed to ' || fn_inr(v_new) || ' by the CT Head · ' || v_proj,
          'You asked to move ' || fn_inr(t.amount) || ' from ' || v_from_lbl || ' to ' || v_to_lbl || '.'
            || chr(10) || chr(10)
            || 'The CT Head approved it at ' || fn_inr(v_new) || ': ' || v_note
            || chr(10) || chr(10)
            || 'It now goes to the Atm Head at the new figure.',
          '/cost-control/projects/' || t.project_id::text, 'cost-control',
          'cc_budget_transfers', t.id);
      end if;
    end if;

  elsif t.status = 'pending_atm' then
    if not (fn_cc_is_admin(v_uid) or v_role = 'head'
            or fn_cc_user_heads_discipline(v_uid, t.from_discipline_id)
            or fn_cc_user_heads_discipline(v_uid, t.to_discipline_id)
            or exists (select 1 from cc_project_approvers
                        where project_id = t.project_id and role = 'head' and user_id = v_uid)) then
      raise exception 'This is waiting for the Atm Head';
    end if;
    if v_note is null then
      raise exception 'Write a comment with your approval — it is compulsory for the Atm Head';
    end if;
    update cc_budget_transfers
       set status = 'pending_trustee', atm_by = v_uid, atm_at = now(), atm_comment = v_note
     where id = p_id;
    v_next := 'pending_trustee';

  elsif t.status = 'pending_trustee' then
    if not (fn_cc_is_admin(v_uid) or v_role = 'founder') then
      raise exception 'This is waiting for the Trustee';
    end if;
    update cc_budget_transfers
       set status = 'awaiting_in4', trustee_by = v_uid, trustee_at = now(), trustee_comment = v_note
     where id = p_id;
    v_next := 'awaiting_in4';

  else
    raise exception 'This request is not waiting for approval — it is %', replace(t.status, '_', ' ');
  end if;

  if v_next in ('pending_atm', 'pending_trustee') then
    perform cc_transfer_notify_pending(p_id);
  else
    -- Fully approved. The only thing left is the move itself, which happens
    -- in IN4, by hand, by the people who have access to it.
    select coalesce(code || ' ', '') || name into v_proj from projects where id = t.project_id;
    for v_who in
      select pr.id from profiles pr
       where pr.is_active
         and (effective_user_role(pr.id, 'cost-control') in ('billing', 'coordinator')
              or fn_cc_is_admin(pr.id))
    loop
      perform notify_user(v_who, 'cc_transfer_awaiting_in4',
        fn_inr(t.amount) || ' to shift in IN4 · ' || v_proj,
        'Approved by the Trustee: shift ' || fn_inr(t.amount) || ' from '
          || fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id) || ' to '
          || fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id) || '.' || chr(10) || chr(10)
          || 'Reason: ' || t.reason || chr(10) || chr(10)
          || 'Make the shift in IN4, then press "Budget shifted in IN4" in the billing queue. '
          || 'The Atm Head is told, and the next sync checks both lines and closes the request '
          || 'once the figures agree.',
        '/cost-control/billing', 'cost-control', 'cc_budget_transfers', t.id);
    end loop;
  end if;

  return v_next;
end $function$;
grant execute on function public.cc_transfer_approve(uuid, text, numeric) to authenticated;

-- ── 3. Notices after the CT Head say what was asked vs what he set ──────
create or replace function public.cc_transfer_notify_pending(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  t        record;
  v_proj   text;
  v_from   text;
  v_to     text;
  v_title  text;
  v_body   text;
  v_who    uuid;
  v_sent   int := 0;
  v_raiser text;
  v_ph     text;
  v_atm    text;
begin
  select * into t from cc_budget_transfers where id = p_id;
  if t.id is null then return 0; end if;
  if t.status not in ('pending_ph', 'pending_atm', 'pending_trustee') then return 0; end if;

  select coalesce(code || ' ', '') || name into v_proj from projects where id = t.project_id;
  v_from := fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id);
  v_to   := fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id);
  select coalesce(full_name, name, email) into v_raiser from profiles where id = t.raised_by;
  select coalesce(full_name, name, email) into v_ph  from profiles where id = t.ph_by;
  select coalesce(full_name, name, email) into v_atm from profiles where id = t.atm_by;

  v_title := fn_inr(t.amount) || ' budget transfer waiting for your approval · ' || v_proj;
  v_body  := case when t.asked_amount is not null and t.asked_amount <> t.amount
                  then coalesce(v_raiser, 'Someone') || ' asked to move ' || fn_inr(t.asked_amount)
                       || ' from ' || v_from || ' to ' || v_to || '; the CT Head changed it to '
                       || fn_inr(t.amount) || '.'
                  else coalesce(v_raiser, 'Someone') || ' is asking to move ' || fn_inr(t.amount)
                       || ' from ' || v_from || ' to ' || v_to || '.'
             end
          || chr(10) || chr(10)
          || 'Reason given: ' || t.reason || chr(10) || chr(10)
          || 'This crosses two work categories, so what each one was approved to spend changes. '
          || 'Nothing moves until it is approved here and then keyed into IN4 — CT Hub never '
          || 'writes a budget itself.'
          || case when t.ph_at is not null
                  then chr(10) || chr(10) || 'CT Head ' || coalesce(v_ph, '') || ' signed: '
                       || coalesce(t.ph_comment, '—')
                  else '' end
          || case when t.status = 'pending_trustee' and t.atm_at is not null
                  then chr(10) || 'Atm Head ' || coalesce(v_atm, '') || ' signed: '
                       || coalesce(t.atm_comment, '—')
                  else '' end
          || case when t.status = 'pending_ph'
                  then chr(10) || chr(10) || 'A comment is compulsory with your approval. You can change the amount, up or down, within what is free on the line.'
                  when t.status = 'pending_atm'
                  then chr(10) || chr(10) || 'A comment is compulsory with your approval.'
                  else '' end;

  for v_who in
    select distinct u from (
      -- CT Head stage: the project's named Project Head; if none is named,
      -- everyone holding the Project Head role.
      select user_id u from cc_project_approvers
       where t.status = 'pending_ph' and project_id = t.project_id and role = 'project_head' and user_id is not null
      union
      select pr.id from profiles pr
       where t.status = 'pending_ph' and pr.is_active
         and effective_user_role(pr.id, 'cost-control') = 'project_head'
         and not exists (select 1 from cc_project_approvers
                          where project_id = t.project_id and role = 'project_head' and user_id is not null)
      union
      -- Atm Head stage: the project's named Heads, plus the Head over either
      -- of the two categories involved. If nobody is named anywhere, fall back
      -- to every Atm Head rather than letting the request sit unseen.
      select user_id from cc_project_approvers
       where t.status = 'pending_atm' and project_id = t.project_id and role = 'head' and user_id is not null
      union
      select approver_user_id from cc_discipline_approvers
       where t.status = 'pending_atm' and is_active
         and discipline_id in (t.from_discipline_id, t.to_discipline_id)
      union
      select pr.id from profiles pr
       where t.status = 'pending_atm' and pr.is_active
         and effective_user_role(pr.id, 'cost-control') = 'head'
         and not exists (select 1 from cc_project_approvers
                          where project_id = t.project_id and role = 'head' and user_id is not null)
         and not exists (select 1 from cc_discipline_approvers
                          where is_active and discipline_id in (t.from_discipline_id, t.to_discipline_id))
      union
      -- Trustee stage.
      select pr.id from profiles pr
       where t.status = 'pending_trustee' and pr.is_active
         and effective_user_role(pr.id, 'cost-control') = 'founder'
    ) s
    where u is not null and u <> coalesce(t.raised_by, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    perform notify_user(v_who, 'cc_transfer_pending', v_title, v_body,
                        '/cost-control/approvals', 'cost-control',
                        'cc_budget_transfers', t.id);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end $function$;

-- ── 4. The inbox: asked figure + the most the CT Head may set ───────────
drop function if exists public.cc_transfer_inbox();
create function public.cc_transfer_inbox()
returns table(id uuid, project_id uuid, project_code text, project_name text, status text, stage text,
              amount numeric, reason text, from_label text, to_label text,
              raised_at timestamptz, raised_by_name text, atm_by_name text, atm_comment text,
              ph_by_name text, ph_comment text, asked_amount numeric, max_amount numeric)
language plpgsql
stable security definer
set search_path = public
as $function$
#variable_conflict use_column
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  v_adm  boolean;
begin
  if v_uid is null then return; end if;
  v_role := effective_user_role(v_uid, 'cost-control');
  v_adm  := fn_cc_is_admin(v_uid);

  return query
  select t.id, t.project_id, pr.code, pr.name,
         t.status,
         case t.status when 'pending_ph' then 'CT Head' when 'pending_atm' then 'Atm Head' else 'Trustee' end,
         t.amount, t.reason,
         fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id),
         fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id),
         t.raised_at, coalesce(rp.full_name, rp.name, rp.email),
         coalesce(ap.full_name, ap.name, ap.email), t.atm_comment,
         coalesce(hp.full_name, hp.name, hp.email), t.ph_comment,
         coalesce(t.asked_amount, t.amount),
         -- Only the CT Head can change it; this request counts as spoken for,
         -- so it is added back.
         case when t.status = 'pending_ph'
              then fn_cc_transfer_free(t.project_id, t.from_discipline_id, t.from_sub_skill_id) + t.amount
         end
    from cc_budget_transfers t
    join projects pr on pr.id = t.project_id
    left join profiles rp on rp.id = t.raised_by
    left join profiles ap on ap.id = t.atm_by
    left join profiles hp on hp.id = t.ph_by
   where t.status in ('pending_ph', 'pending_atm', 'pending_trustee')
     and (v_adm or t.raised_by is distinct from v_uid)
     and (
       (t.status = 'pending_ph' and fn_cc_transfer_is_ct_head(v_uid, t.project_id))
       or (t.status = 'pending_atm' and (
          v_adm or v_role = 'head'
          or fn_cc_user_heads_discipline(v_uid, t.from_discipline_id)
          or fn_cc_user_heads_discipline(v_uid, t.to_discipline_id)
          or exists (select 1 from cc_project_approvers pa
                      where pa.project_id = t.project_id and pa.role = 'head' and pa.user_id = v_uid)))
       or (t.status = 'pending_trustee' and (v_adm or v_role = 'founder'))
     )
   order by t.raised_at;
end $function$;
grant execute on function public.cc_transfer_inbox() to authenticated;

-- ── 5. The project's list: the asked figure too ─────────────────────────
drop function if exists public.cc_project_transfers(uuid);
create function public.cc_project_transfers(p_project uuid)
returns table(id uuid, status text, amount numeric, reason text,
              from_discipline_id uuid, from_sub_skill_id uuid, from_label text,
              to_discipline_id uuid, to_sub_skill_id uuid, to_label text,
              raised_at timestamptz, raised_by_name text, raised_by_me boolean,
              atm_at timestamptz, atm_by_name text, atm_comment text,
              trustee_at timestamptz, trustee_by_name text, trustee_comment text,
              in4_at timestamptz, in4_by_name text, confirmed_at timestamptz, settle_note text,
              closed_at timestamptz, closed_by_name text, closed_reason text,
              ph_at timestamptz, ph_by_name text, ph_comment text, asked_amount numeric)
language plpgsql
stable security definer
set search_path = public
as $function$
#variable_conflict use_column
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  v_role := effective_user_role(v_uid, 'cost-control');
  if not (fn_cc_is_admin(v_uid) or v_role in ('billing', 'coordinator', 'founder')
          or fn_cc_user_in_project(v_uid, p_project)) then
    raise exception 'You do not have access to this project';
  end if;

  return query
  select t.id, t.status, t.amount, t.reason,
         t.from_discipline_id, t.from_sub_skill_id, fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id),
         t.to_discipline_id, t.to_sub_skill_id, fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id),
         t.raised_at, coalesce(rp.full_name, rp.name, rp.email), t.raised_by = v_uid,
         t.atm_at, coalesce(ap.full_name, ap.name, ap.email), t.atm_comment,
         t.trustee_at, coalesce(tp.full_name, tp.name, tp.email), t.trustee_comment,
         t.in4_at, coalesce(ip.full_name, ip.name, ip.email),
         t.confirmed_at, t.settle_note,
         t.closed_at, coalesce(cp.full_name, cp.name, cp.email), t.closed_reason,
         t.ph_at, coalesce(hp.full_name, hp.name, hp.email), t.ph_comment,
         coalesce(t.asked_amount, t.amount)
    from cc_budget_transfers t
    left join profiles rp on rp.id = t.raised_by
    left join profiles ap on ap.id = t.atm_by
    left join profiles tp on tp.id = t.trustee_by
    left join profiles ip on ip.id = t.in4_by
    left join profiles cp on cp.id = t.closed_by
    left join profiles hp on hp.id = t.ph_by
   where t.project_id = p_project
   order by t.raised_at desc;
end $function$;
grant execute on function public.cc_project_transfers(uuid) to authenticated;
