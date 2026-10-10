-- Budget shifting: a CT Head step before the Atm Head, compulsory comments,
-- and the Atm Head told once the shift is made in IN4 (Aksha, 10 Oct 2026).
--
--   "Parimal raises request - it should go to CT head he should be able to
--    approve/reject and comment compulsory. Then Atm head should also be able
--    to approve/reject and comment compulsory. Then Trustee get the
--    approve/reject - will finally approve and then parimal does in4 entry as
--    Budget shifted in In4 - will be done the respective Atm head will be
--    informed"
--
-- His answers to the three open points:
--   • CT Head = the project's named Project Head (Mayank Adhvaryoo on every
--     project today). If a project names none, anyone holding the Project Head
--     role in Cost Control may sign — same fallback the Atm Head step uses.
--   • The Trustee's approval comment stays optional (turning down still needs
--     a reason at every step).
--   • The AB ₹21,500 request already with the Atm Head goes back to the CT
--     Head and follows the new flow from the start.
--
-- New chain:  pending_ph (CT Head) → pending_atm (Atm Head) → pending_trustee
--             → awaiting_in4 → awaiting_sync → confirmed
-- Who raised it still never signs it: a Project Head raising starts at the Atm
-- Head; an Atm Head raising still starts at the Trustee (unchanged).

-- ── 1. The CT Head's sign-off on the row ─────────────────────────────────
alter table public.cc_budget_transfers
  add column if not exists ph_by      uuid references public.profiles(id),
  add column if not exists ph_at      timestamptz,
  add column if not exists ph_comment text;

alter table public.cc_budget_transfers drop constraint if exists cc_budget_transfers_status_check;
alter table public.cc_budget_transfers add constraint cc_budget_transfers_status_check
  check (status in ('pending_ph', 'pending_atm', 'pending_trustee', 'awaiting_in4',
                    'awaiting_sync', 'confirmed', 'rejected', 'cancelled'));
alter table public.cc_budget_transfers alter column status set default 'pending_ph';

-- ── 2. Who is the CT Head for a project ─────────────────────────────────
create or replace function public.fn_cc_transfer_is_ct_head(p_user uuid, p_project uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select p_user is not null and (
       fn_cc_is_admin(p_user)
    or exists (select 1 from cc_project_approvers
                where project_id = p_project and role = 'project_head' and user_id = p_user)
    or (effective_user_role(p_user, 'cost-control') = 'project_head'
        and not exists (select 1 from cc_project_approvers
                         where project_id = p_project and role = 'project_head' and user_id is not null))
  );
$$;

-- ── 3. Money waiting at the CT Head is spoken for too ───────────────────
create or replace function public.fn_cc_transfer_free(p_project uuid, p_disc uuid, p_sub uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select greatest(0, fn_cc_savings(p_project, p_disc, p_sub) - coalesce((
           select sum(amount) from cc_budget_transfers
            where project_id = p_project
              and from_discipline_id = p_disc
              and from_sub_skill_id = p_sub
              and status in ('pending_ph', 'pending_atm', 'pending_trustee', 'awaiting_in4', 'awaiting_sync')
         ), 0));
$$;

-- ── 4. Raise: starts at the CT Head ─────────────────────────────────────
create or replace function public.cc_transfer_raise(
  p_project uuid, p_from_disc uuid, p_from_sub uuid, p_to_disc uuid, p_to_sub uuid,
  p_amount numeric, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid   uuid := (select auth.uid());
  v_role  text;
  v_amt   numeric := round(coalesce(p_amount, 0));
  v_free  numeric;
  v_id    uuid;
  v_status text;
  v_from_lbl text;
  v_to_lbl   text;
  v_proj  text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not fn_cc_can_raise_transfer(v_uid) then
    raise exception 'Only the Atm Head, Project Head, Coordinator or an Admin can request a budget transfer';
  end if;
  v_role := effective_user_role(v_uid, 'cost-control');

  -- The Coordinator and Admins work across every project by role; everyone
  -- else has to belong to this one.
  if not (fn_cc_is_admin(v_uid) or v_role = 'coordinator' or fn_cc_user_in_project(v_uid, p_project)) then
    raise exception 'You do not have access to this project';
  end if;

  if p_from_sub is null or p_to_sub is null then
    raise exception 'Pick a sub-category on both sides — IN4 holds the budget at that level';
  end if;
  if p_from_sub = p_to_sub then
    raise exception 'The two lines are the same';
  end if;

  -- Inside one work category the HOD already allows free movement and CT Hub
  -- picks those up on its own after each sync. Say that, rather than creating
  -- a second way to do the same thing.
  if p_from_disc = p_to_disc then
    raise exception 'Both lines are in the same work category. Moving budget inside a category is already allowed without a request — CT Hub labels it automatically after the next IN4 sync.';
  end if;

  if v_amt <= 0 then raise exception 'Enter an amount to move'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the budget is moving — this is the record everyone reads later';
  end if;

  -- Both lines have to be set up on this project, or there is nothing to move
  -- between.
  if not exists (select 1 from cc_budget_lines
                  where project_id = p_project and discipline_id = p_from_disc and sub_skill_id = p_from_sub) then
    raise exception 'The line you are moving budget out of is not set up on this project';
  end if;
  if not exists (select 1 from cc_budget_lines
                  where project_id = p_project and discipline_id = p_to_disc and sub_skill_id = p_to_sub) then
    raise exception 'The line you are moving budget into is not set up on this project';
  end if;

  -- A closed line's leftover budget is already promised to the ERP reduction
  -- queue. Letting it also fund a transfer would spend the same money twice.
  if exists (select 1 from cc_project_sub_skills
              where project_id = p_project and sub_skill_id = p_from_sub and completed_at is not null) then
    raise exception 'That line is marked Completed — its leftover budget is already queued to come out of IN4. Reopen it first if the money should move instead.';
  end if;
  if exists (select 1 from cc_project_sub_skills
              where project_id = p_project and sub_skill_id = p_to_sub and completed_at is not null) then
    raise exception 'The receiving line is marked Completed, so no more budget can go into it. Reopen it first.';
  end if;

  -- Hard cap. Money already paid, or committed on a work order, is not
  -- available to move — a bill is coming for it.
  v_free := fn_cc_transfer_free(p_project, p_from_disc, p_from_sub);
  if v_amt > v_free then
    raise exception 'Only % is free to move off that line. The rest is already paid or committed on a WO/PO.', fn_inr(v_free);
  end if;

  -- Everyone starts at the CT Head (Aksha, 10 Oct 2026). The raiser never
  -- signs their own step: a Project Head (CT Head) raising it starts at the
  -- Atm Head; an Atm Head raising it has, in effect, already given the
  -- category nod, so it goes straight to the Trustee (as before).
  v_status := case when v_role = 'head' then 'pending_trustee'
                   when v_role = 'project_head' then 'pending_atm'
                   else 'pending_ph' end;

  insert into cc_budget_transfers (
    project_id, from_discipline_id, from_sub_skill_id, to_discipline_id, to_sub_skill_id,
    amount, reason, status,
    from_budget_at_raise, to_budget_at_raise,
    raised_by,
    ph_by, ph_at, ph_comment,
    atm_by, atm_at, atm_comment
  ) values (
    p_project, p_from_disc, p_from_sub, p_to_disc, p_to_sub,
    v_amt, btrim(p_reason), v_status,
    fn_cc_line_budget(p_project, p_from_disc, p_from_sub),
    fn_cc_line_budget(p_project, p_to_disc, p_to_sub),
    v_uid,
    case when v_role = 'project_head' then v_uid end,
    case when v_role = 'project_head' then now() end,
    case when v_role = 'project_head' then 'Raised by the CT Head' end,
    case when v_role = 'head' then v_uid end,
    case when v_role = 'head' then now() end,
    case when v_role = 'head' then 'Raised by the Atm Head' end
  ) returning id into v_id;

  select coalesce(code || ' ', '') || name into v_proj from projects where id = p_project;
  v_from_lbl := fn_cc_line_label(p_from_disc, p_from_sub);
  v_to_lbl   := fn_cc_line_label(p_to_disc, p_to_sub);
  perform cc_transfer_notify_pending(v_id);

  -- Audit on BOTH lines, before any money moves. Whichever line someone is
  -- reading, the pending request is part of that line's story.
  insert into cc_budget_events (budget_line_id, project_id, event_type, delta_amount, related_budget_line_id, remarks, channel, requested_by, approval_status, event_date)
  select f.id, p_project, 'budget_update', 0, t.id,
         'Transfer requested — ' || fn_inr(v_amt) || ' to move OUT to ' || v_to_lbl || ' · ' || btrim(p_reason),
         'web', v_uid, 'pending', now()
    from cc_budget_lines f, cc_budget_lines t
   where f.project_id = p_project and f.discipline_id = p_from_disc and f.sub_skill_id = p_from_sub
     and t.project_id = p_project and t.discipline_id = p_to_disc   and t.sub_skill_id = p_to_sub
   limit 1;

  insert into cc_budget_events (budget_line_id, project_id, event_type, delta_amount, related_budget_line_id, remarks, channel, requested_by, approval_status, event_date)
  select t.id, p_project, 'budget_update', 0, f.id,
         'Transfer requested — ' || fn_inr(v_amt) || ' to come IN from ' || v_from_lbl || ' · ' || btrim(p_reason),
         'web', v_uid, 'pending', now()
    from cc_budget_lines f, cc_budget_lines t
   where f.project_id = p_project and f.discipline_id = p_from_disc and f.sub_skill_id = p_from_sub
     and t.project_id = p_project and t.discipline_id = p_to_disc   and t.sub_skill_id = p_to_sub
   limit 1;

  return v_id;
end $function$;

-- ── 5. Approve: CT Head → Atm Head → Trustee; comment compulsory for the
--       CT Head and the Atm Head ───────────────────────────────────────────
create or replace function public.cc_transfer_approve(p_id uuid, p_comment text default null)
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
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into t from cc_budget_transfers where id = p_id for update;
  if t.id is null then raise exception 'That transfer request no longer exists'; end if;
  v_role := effective_user_role(v_uid, 'cost-control');

  if t.raised_by = v_uid and not fn_cc_is_admin(v_uid) then
    raise exception 'You raised this request, so somebody else has to approve it';
  end if;

  if t.status = 'pending_ph' then
    if not fn_cc_transfer_is_ct_head(v_uid, t.project_id) then
      raise exception 'This is waiting for the CT Head';
    end if;
    if v_note is null then
      raise exception 'Write a comment with your approval — it is compulsory for the CT Head';
    end if;
    update cc_budget_transfers
       set status = 'pending_atm', ph_by = v_uid, ph_at = now(), ph_comment = v_note
     where id = p_id;
    v_next := 'pending_atm';

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

-- ── 6. Turn down: the CT Head can now, at his step ──────────────────────
create or replace function public.cc_transfer_reject(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  t      record;
  v_proj text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why it is being turned down — the person who raised it has to know what to change';
  end if;
  select * into t from cc_budget_transfers where id = p_id for update;
  if t.id is null then raise exception 'That transfer request no longer exists'; end if;
  v_role := effective_user_role(v_uid, 'cost-control');

  if t.status = 'pending_ph' then
    if not (fn_cc_transfer_is_ct_head(v_uid, t.project_id) or v_role = 'founder') then
      raise exception 'Only the CT Head can turn this down at this stage';
    end if;
  elsif t.status = 'pending_atm' then
    if not (fn_cc_is_admin(v_uid) or v_role in ('head', 'founder')
            or fn_cc_user_heads_discipline(v_uid, t.from_discipline_id)
            or fn_cc_user_heads_discipline(v_uid, t.to_discipline_id)
            or exists (select 1 from cc_project_approvers
                        where project_id = t.project_id and role = 'head' and user_id = v_uid)) then
      raise exception 'Only the Atm Head can turn this down';
    end if;
  elsif t.status = 'pending_trustee' then
    if not (fn_cc_is_admin(v_uid) or v_role = 'founder') then
      raise exception 'Only the Trustee can turn this down at this stage';
    end if;
  elsif t.status = 'awaiting_in4' then
    -- Approved but not yet done in IN4 — the Trustee or an Admin can still
    -- call it off, since no money has moved.
    if not (fn_cc_is_admin(v_uid) or v_role = 'founder') then
      raise exception 'This is already approved. Only the Trustee or an Admin can call it off now.';
    end if;
  else
    raise exception 'This request is already %', replace(t.status, '_', ' ');
  end if;

  update cc_budget_transfers
     set status = 'rejected', closed_by = v_uid, closed_at = now(), closed_reason = btrim(p_reason)
   where id = p_id;

  select coalesce(code || ' ', '') || name into v_proj from projects where id = t.project_id;
  if t.raised_by is not null and t.raised_by <> v_uid then
    perform notify_user(t.raised_by, 'cc_transfer_rejected',
      fn_inr(t.amount) || ' budget transfer turned down · ' || v_proj,
      'Your request to move ' || fn_inr(t.amount) || ' from '
        || fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id) || ' to '
        || fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id)
        || ' was not approved.' || chr(10) || chr(10) || 'Reason: ' || btrim(p_reason),
      '/cost-control/projects/' || t.project_id::text, 'cost-control',
      'cc_budget_transfers', t.id);
  end if;
end $function$;

-- ── 7. Withdraw: also while it is with the CT Head ──────────────────────
create or replace function public.cc_transfer_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  t     record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into t from cc_budget_transfers where id = p_id for update;
  if t.id is null then raise exception 'That transfer request no longer exists'; end if;
  if not (fn_cc_is_admin(v_uid) or t.raised_by = v_uid) then
    raise exception 'Only the person who raised this, or an Admin, can withdraw it';
  end if;
  if t.status not in ('pending_ph', 'pending_atm', 'pending_trustee') then
    raise exception 'Too late to withdraw — this request is already %', replace(t.status, '_', ' ');
  end if;
  update cc_budget_transfers
     set status = 'cancelled', closed_by = v_uid, closed_at = now(),
         closed_reason = 'Withdrawn by the person who raised it'
   where id = p_id;
end $function$;

-- ── 8. Who is told it is waiting ────────────────────────────────────────
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
  v_body  := coalesce(v_raiser, 'Someone') || ' is asking to move ' || fn_inr(t.amount)
          || ' from ' || v_from || ' to ' || v_to || '.' || chr(10) || chr(10)
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
          || case when t.status in ('pending_ph', 'pending_atm')
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

-- ── 9. "Budget shifted in IN4" → the respective Atm Head is told ────────
create or replace function public.cc_transfer_mark_in4(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  t      record;
  v_proj text;
  v_me   text;
  v_who  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  v_role := effective_user_role(v_uid, 'cost-control');
  if not (fn_cc_is_admin(v_uid) or v_role in ('billing', 'coordinator')) then
    raise exception 'Only Billing or the Coordinator records the IN4 move';
  end if;

  select * into t from cc_budget_transfers where id = p_id for update;
  if t.id is null then raise exception 'That transfer request no longer exists'; end if;
  if t.status <> 'awaiting_in4' then
    raise exception 'This request is %, so it is not waiting on IN4', replace(t.status, '_', ' ');
  end if;

  update cc_budget_transfers
     set status = 'awaiting_sync', in4_by = v_uid, in4_at = now(),
         from_budget_at_in4 = fn_cc_line_budget(t.project_id, t.from_discipline_id, t.from_sub_skill_id),
         to_budget_at_in4   = fn_cc_line_budget(t.project_id, t.to_discipline_id, t.to_sub_skill_id),
         settle_note = null
   where id = p_id;

  -- Tell the respective Atm Head (Aksha, 10 Oct 2026): the one who signed it,
  -- and the project's named Atm Head(s).
  select coalesce(code || ' ', '') || name into v_proj from projects where id = t.project_id;
  select coalesce(full_name, name, email) into v_me from profiles where id = v_uid;
  for v_who in
    select distinct u from (
      select t.atm_by u
      union
      select user_id from cc_project_approvers
       where project_id = t.project_id and role = 'head' and user_id is not null
    ) s
    where u is not null and u <> v_uid
  loop
    perform notify_user(v_who, 'cc_transfer_in4_done',
      fn_inr(t.amount) || ' budget shifted in IN4 · ' || v_proj,
      coalesce(v_me, 'Billing') || ' has shifted ' || fn_inr(t.amount) || ' in IN4, from '
        || fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id) || ' to '
        || fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id) || '.' || chr(10) || chr(10)
        || 'Reason: ' || t.reason || chr(10) || chr(10)
        || 'The next IN4 sync checks both lines and closes the request once the figures agree.',
      '/cost-control/projects/' || t.project_id::text, 'cost-control',
      'cc_budget_transfers', t.id);
  end loop;

  -- A sync may already have picked the move up before this tick, in which
  -- case there is nothing to wait for.
  return cc_transfer_verify_one(p_id);
end $function$;

-- ── 10. The inbox: the CT Head's step, and his comment for those after ──
drop function if exists public.cc_transfer_inbox();
create function public.cc_transfer_inbox()
returns table(id uuid, project_id uuid, project_code text, project_name text, status text, stage text,
              amount numeric, reason text, from_label text, to_label text,
              raised_at timestamptz, raised_by_name text, atm_by_name text, atm_comment text,
              ph_by_name text, ph_comment text)
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
         coalesce(hp.full_name, hp.name, hp.email), t.ph_comment
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

-- ── 11. The project's list: the CT Head's sign-off in the trail ─────────
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
              ph_at timestamptz, ph_by_name text, ph_comment text)
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
         t.ph_at, coalesce(hp.full_name, hp.name, hp.email), t.ph_comment
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

-- ── 12. The AB request already with the Atm Head goes back to the CT Head
--        (Aksha's pick) and Mayank is told. Guarded on its current state, so
--        re-running this does nothing once it has moved on.
do $$
declare v_id uuid := 'bc090e95-ad80-4983-8789-ffca8af155ad';
begin
  update cc_budget_transfers
     set status = 'pending_ph'
   where id = v_id and status = 'pending_atm' and atm_by is null and ph_by is null;
  if found then
    perform cc_transfer_notify_pending(v_id);
  end if;
end $$;
