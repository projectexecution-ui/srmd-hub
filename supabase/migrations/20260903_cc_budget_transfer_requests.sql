-- ERP Budget Transfer Requests — moving approved budget from one work
-- category to another.
--
-- Inside a single work category the HOD already permits free movement, and
-- cc_detect_budget_transfers() spots those after each BPH pull. Crossing
-- categories is a different act: it changes what each category was approved
-- to spend, and today it happens in IN4 with nothing in CT Hub to show it.
--
-- This is a REQUEST, not a ledger entry. CT Hub never writes a budget — only
-- IN4 does. The request records the intent, carries it through approval, tells
-- the person with IN4 access to make the move, and then checks the next sync
-- to see whether it actually happened. A transfer approved but never made is
-- precisely the thing that would otherwise surface months later.
--
-- Deliberately NOT a working sheet: no money is being approved, so it must
-- never appear as new budget anywhere.

create table if not exists public.cc_budget_transfers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,

  -- The line losing budget, and the line gaining it. Sub-category level,
  -- because that is the level IN4 holds a budget at.
  from_discipline_id uuid not null references public.cc_disciplines(id),
  from_sub_skill_id  uuid not null references public.cc_sub_skills(id),
  to_discipline_id   uuid not null references public.cc_disciplines(id),
  to_sub_skill_id    uuid not null references public.cc_sub_skills(id),

  amount numeric not null check (amount > 0),
  reason text not null,

  status text not null default 'pending_atm' check (status in (
    'pending_atm',      -- waiting on the Atm Head
    'pending_trustee',  -- waiting on the Trustee
    'awaiting_in4',     -- approved; nobody has moved it in IN4 yet
    'awaiting_sync',    -- moved in IN4; waiting for a pull to prove it
    'confirmed',        -- the sync matched both sides
    'rejected',
    'cancelled'
  )),

  -- Budget on each line when the request was raised, and again when IN4 was
  -- ticked. The second pair is what verification measures against: a budget
  -- that moved for some other reason in between must not be read as this
  -- transfer having happened.
  from_budget_at_raise numeric,
  to_budget_at_raise   numeric,
  from_budget_at_in4   numeric,
  to_budget_at_in4     numeric,

  raised_by uuid references public.profiles(id),
  raised_at timestamptz not null default now(),

  atm_by uuid references public.profiles(id),
  atm_at timestamptz,
  atm_comment text,

  trustee_by uuid references public.profiles(id),
  trustee_at timestamptz,
  trustee_comment text,

  in4_by uuid references public.profiles(id),
  in4_at timestamptz,

  confirmed_at timestamptz,
  -- What the last verification pass saw. Populated when the numbers disagree,
  -- so the request explains itself instead of just sitting there.
  settle_note text,

  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  closed_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Money cannot move to the place it came from.
  constraint cc_bt_two_lines check (from_sub_skill_id <> to_sub_skill_id)
);

create index if not exists cc_bt_project_idx on public.cc_budget_transfers (project_id, status);
create index if not exists cc_bt_open_idx on public.cc_budget_transfers (status)
  where status in ('pending_atm', 'pending_trustee', 'awaiting_in4', 'awaiting_sync');
create index if not exists cc_bt_from_idx on public.cc_budget_transfers (project_id, from_discipline_id, from_sub_skill_id);
create index if not exists cc_bt_to_idx   on public.cc_budget_transfers (project_id, to_discipline_id, to_sub_skill_id);

drop trigger if exists trg_cc_bt_touch on public.cc_budget_transfers;
create trigger trg_cc_bt_touch before update on public.cc_budget_transfers
  for each row execute function public.fn_cc_touch_updated_at();

-- Reading follows the same gate as the rest of Cost Control. Writing happens
-- only through the definer functions below, so there are no write policies.
alter table public.cc_budget_transfers enable row level security;

drop policy if exists cc_bt_read on public.cc_budget_transfers;
create policy cc_bt_read on public.cc_budget_transfers for select
  using (
    public.fn_cc_is_admin(auth.uid())
    or public.fn_cc_user_in_project(auth.uid(), project_id)
    or public.effective_user_role(auth.uid(), 'cost-control') in ('billing', 'coordinator', 'founder')
  );

-- ============================================================
-- Who may raise one
-- ============================================================
-- The Atm Heads, the Project Head, the Coordinator (who also does the IN4
-- step) and Admins. Engineers are out: an ENG role carries edit rights on
-- every project with no assignment, and moving budget between categories is
-- a management call. The Trustee is out because the Trustee is the final
-- approver — a Trustee-raised request would have nobody above it to sign.
create or replace function public.fn_cc_can_raise_transfer(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select p_user is not null
     and (fn_cc_is_admin(p_user)
          or effective_user_role(p_user, 'cost-control') in ('head', 'project_head', 'coordinator'));
$fn$;

-- "May I raise one?" answered for the caller, so a screen never has to know
-- its own user id to decide whether to offer the control.
create or replace function public.cc_can_i_raise_transfer()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select public.fn_cc_can_raise_transfer((select auth.uid()));
$fn$;

-- A readable "03 Civil › 302 Steel Works" for messages and audit remarks.
create or replace function public.fn_cc_line_label(p_disc uuid, p_sub uuid)
returns text language sql stable set search_path to 'public' as $fn$
  select coalesce(d.code || ' ', '') || d.name || ' › ' || coalesce(s.code || ' ', '') || s.name
    from cc_disciplines d, cc_sub_skills s
   where d.id = p_disc and s.id = p_sub;
$fn$;

-- Budget currently on one sub-category line, as IN4 last told us.
create or replace function public.fn_cc_line_budget(p_project uuid, p_disc uuid, p_sub uuid)
returns numeric language sql stable set search_path to 'public' as $fn$
  select round(coalesce(sum(current_budget_amt), 0))
    from cc_budget_lines
   where project_id = p_project and discipline_id = p_disc and sub_skill_id = p_sub;
$fn$;

-- What is actually free to move off a line: budget not yet paid and not yet
-- committed on a work order, LESS anything already promised away by another
-- open request. Without that subtraction two requests could each pass the cap
-- on their own and together move money that does not exist.
create or replace function public.fn_cc_transfer_free(p_project uuid, p_disc uuid, p_sub uuid)
returns numeric language sql stable set search_path to 'public' as $fn$
  select greatest(0, fn_cc_savings(p_project, p_disc, p_sub) - coalesce((
           select sum(amount) from cc_budget_transfers
            where project_id = p_project
              and from_discipline_id = p_disc
              and from_sub_skill_id = p_sub
              and status in ('pending_atm', 'pending_trustee', 'awaiting_in4', 'awaiting_sync')
         ), 0));
$fn$;

-- ============================================================
-- Raise
-- ============================================================
create or replace function public.cc_transfer_raise(
  p_project uuid,
  p_from_disc uuid, p_from_sub uuid,
  p_to_disc uuid, p_to_sub uuid,
  p_amount numeric,
  p_reason text
) returns uuid language plpgsql security definer set search_path to 'public' as $fn$
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

  -- An Atm Head raising it has, in effect, already given the category nod, so
  -- it goes straight to the Trustee. Anyone else starts at the Atm Head.
  -- Either way the raiser never signs their own request.
  v_status := case when v_role = 'head' then 'pending_trustee' else 'pending_atm' end;

  insert into cc_budget_transfers (
    project_id, from_discipline_id, from_sub_skill_id, to_discipline_id, to_sub_skill_id,
    amount, reason, status,
    from_budget_at_raise, to_budget_at_raise,
    raised_by,
    atm_by, atm_at, atm_comment
  ) values (
    p_project, p_from_disc, p_from_sub, p_to_disc, p_to_sub,
    v_amt, btrim(p_reason), v_status,
    fn_cc_line_budget(p_project, p_from_disc, p_from_sub),
    fn_cc_line_budget(p_project, p_to_disc, p_to_sub),
    v_uid,
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
end $fn$;

-- ============================================================
-- Telling the right desk it is their turn
-- ============================================================
-- One function for both approval stages, so the wording and the routing can
-- never drift apart. The raiser is always excluded — nobody is told to
-- approve their own request.
create or replace function public.cc_transfer_notify_pending(p_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $fn$
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
begin
  select * into t from cc_budget_transfers where id = p_id;
  if t.id is null then return 0; end if;
  if t.status not in ('pending_atm', 'pending_trustee') then return 0; end if;

  select coalesce(code || ' ', '') || name into v_proj from projects where id = t.project_id;
  v_from := fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id);
  v_to   := fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id);
  select coalesce(full_name, name, email) into v_raiser from profiles where id = t.raised_by;

  v_title := fn_inr(t.amount) || ' budget transfer waiting for your approval · ' || v_proj;
  v_body  := coalesce(v_raiser, 'Someone') || ' is asking to move ' || fn_inr(t.amount)
          || ' from ' || v_from || ' to ' || v_to || '.' || chr(10) || chr(10)
          || 'Reason given: ' || t.reason || chr(10) || chr(10)
          || 'This crosses two work categories, so what each one was approved to spend changes. '
          || 'Nothing moves until it is approved here and then keyed into IN4 — CT Hub never '
          || 'writes a budget itself.'
          || case when t.status = 'pending_trustee'
                  then chr(10) || chr(10) || 'The Atm Head has already signed it.'
                  else '' end;

  for v_who in
    -- Atm Head stage: the project's named Heads, plus the Head over either
    -- of the two categories involved. If nobody is named anywhere, fall back
    -- to every Atm Head rather than letting the request sit unseen.
    select distinct u from (
      select user_id u from cc_project_approvers
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
end $fn$;

-- ============================================================
-- Approve — one door for both stages
-- ============================================================
create or replace function public.cc_transfer_approve(p_id uuid, p_comment text default null)
returns text language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  t      record;
  v_next text;
  v_proj text;
  v_who  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into t from cc_budget_transfers where id = p_id for update;
  if t.id is null then raise exception 'That transfer request no longer exists'; end if;
  v_role := effective_user_role(v_uid, 'cost-control');

  if t.raised_by = v_uid and not fn_cc_is_admin(v_uid) then
    raise exception 'You raised this request, so somebody else has to approve it';
  end if;

  if t.status = 'pending_atm' then
    if not (fn_cc_is_admin(v_uid) or v_role = 'head'
            or fn_cc_user_heads_discipline(v_uid, t.from_discipline_id)
            or fn_cc_user_heads_discipline(v_uid, t.to_discipline_id)
            or exists (select 1 from cc_project_approvers
                        where project_id = t.project_id and role = 'head' and user_id = v_uid)) then
      raise exception 'This is waiting for the Atm Head';
    end if;
    update cc_budget_transfers
       set status = 'pending_trustee', atm_by = v_uid, atm_at = now(),
           atm_comment = nullif(btrim(p_comment), '')
     where id = p_id;
    v_next := 'pending_trustee';

  elsif t.status = 'pending_trustee' then
    if not (fn_cc_is_admin(v_uid) or v_role = 'founder') then
      raise exception 'This is waiting for the Trustee';
    end if;
    update cc_budget_transfers
       set status = 'awaiting_in4', trustee_by = v_uid, trustee_at = now(),
           trustee_comment = nullif(btrim(p_comment), '')
     where id = p_id;
    v_next := 'awaiting_in4';

  else
    raise exception 'This request is not waiting for approval — it is %', replace(t.status, '_', ' ');
  end if;

  if v_next = 'pending_trustee' then
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
        fn_inr(t.amount) || ' to move in IN4 · ' || v_proj,
        'Approved by the Trustee: move ' || fn_inr(t.amount) || ' from '
          || fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id) || ' to '
          || fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id) || '.' || chr(10) || chr(10)
          || 'Reason: ' || t.reason || chr(10) || chr(10)
          || 'Make the move in IN4, then tick it in the billing queue. The next sync '
          || 'checks both lines and closes the request once the figures agree.',
        '/cost-control/billing', 'cost-control', 'cc_budget_transfers', t.id);
    end loop;
  end if;

  return v_next;
end $fn$;

-- ============================================================
-- Reject / withdraw
-- ============================================================
create or replace function public.cc_transfer_reject(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $fn$
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

  if t.status = 'pending_atm' then
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
end $fn$;

-- The person who raised it can withdraw it while nothing has moved.
create or replace function public.cc_transfer_cancel(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
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
  if t.status not in ('pending_atm', 'pending_trustee') then
    raise exception 'Too late to withdraw — this request is already %', replace(t.status, '_', ' ');
  end if;
  update cc_budget_transfers
     set status = 'cancelled', closed_by = v_uid, closed_at = now(),
         closed_reason = 'Withdrawn by the person who raised it'
   where id = p_id;
end $fn$;

-- ============================================================
-- Done in IN4 — and then proving it
-- ============================================================
-- Ticking this is a claim, not evidence. It snapshots what CT Hub currently
-- believes each line holds, so the next pull has something exact to check
-- against, then hands the request to verification.
create or replace function public.cc_transfer_mark_in4(p_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  t      record;
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

  -- A sync may already have picked the move up before this tick, in which
  -- case there is nothing to wait for.
  return cc_transfer_verify_one(p_id);
end $fn$;

-- Check one request against what IN4 now says. Returns the resulting status.
--
-- Measured from either baseline: the figures at the time of the tick, or the
-- figures at the time it was raised. The second covers the case where a pull
-- landed the move before anyone ticked it — otherwise a correctly executed
-- transfer would be reported as a mismatch.
create or replace function public.cc_transfer_verify_one(p_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $fn$
declare
  t         record;
  v_from    numeric;
  v_to      numeric;
  v_matched boolean;
  v_unmoved boolean;
  v_no_sync boolean;
  v_settle  text;
  v_moved_f numeric;
  v_moved_t numeric;
  v_note    text;
  v_proj    text;
  v_who     uuid;
  v_hit     int := 0;
  v_f_line  uuid;
  v_t_line  uuid;
begin
  select * into t from cc_budget_transfers where id = p_id for update;
  if t.id is null or t.status <> 'awaiting_sync' then
    return coalesce(t.status, 'gone');
  end if;

  v_from := fn_cc_line_budget(t.project_id, t.from_discipline_id, t.from_sub_skill_id);
  v_to   := fn_cc_line_budget(t.project_id, t.to_discipline_id, t.to_sub_skill_id);

  -- Rounding between IN4 and here can differ by a rupee or two; anything
  -- larger is a real difference and must not be waved through.
  v_matched :=
       (abs(v_from - (coalesce(t.from_budget_at_in4, t.from_budget_at_raise) - t.amount)) <= 2
        and abs(v_to - (coalesce(t.to_budget_at_in4, t.to_budget_at_raise) + t.amount)) <= 2)
    or (t.from_budget_at_raise is not null and t.to_budget_at_raise is not null
        and abs(v_from - (t.from_budget_at_raise - t.amount)) <= 2
        and abs(v_to - (t.to_budget_at_raise + t.amount)) <= 2);

  v_unmoved := abs(v_from - coalesce(t.from_budget_at_in4, t.from_budget_at_raise, v_from)) <= 2
           and abs(v_to - coalesce(t.to_budget_at_in4, t.to_budget_at_raise, v_to)) <= 2;

  -- A project with no BPH link never receives figures from IN4, so nothing
  -- can ever match. Two of the projects carrying budget are in that state.
  v_no_sync := not exists (select 1 from cc_bph_project_links where cc_project_id = t.project_id);

  if v_matched then
    v_settle := 'Matched by the IN4 sync — both lines moved by ' || fn_inr(t.amount) || '.';
  elsif v_unmoved and v_no_sync then
    -- Accept it, but never pretend it was verified.
    v_matched := true;
    v_settle := 'Accepted as done on the record of '
             || coalesce((select coalesce(full_name, name, email) from profiles where id = t.in4_by), 'whoever ticked it')
             || '. This project is not linked to a BPH report, so no sync brings its figures '
             || 'in from IN4 and CT Hub cannot check the two lines itself.';
  end if;

  select coalesce(code || ' ', '') || name into v_proj from projects where id = t.project_id;

  select id into v_f_line from cc_budget_lines
   where project_id = t.project_id and discipline_id = t.from_discipline_id
     and sub_skill_id = t.from_sub_skill_id limit 1;
  select id into v_t_line from cc_budget_lines
   where project_id = t.project_id and discipline_id = t.to_discipline_id
     and sub_skill_id = t.to_sub_skill_id limit 1;

  -- It happened.
  if v_matched then
    update cc_budget_transfers
       set status = 'confirmed', confirmed_at = now(), settle_note = v_settle
     where id = p_id;

    -- Label the sync's own budget movements as the two halves of this
    -- transfer, rather than leaving them as unexplained adjustments.
    with hit as (
      update cc_budget_events be
         -- event_type is an enum, so the branch has to be cast before assignment.
         set event_type = (case when be.delta_amount < 0 then 'budget_shift_out'
                                else 'budget_shift_in' end)::cc_event_type,
             related_budget_line_id = case when be.delta_amount < 0 then v_t_line else v_f_line end,
             remarks = case when be.delta_amount < 0
                            then 'Moved to ' || fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id)
                            else 'Moved from ' || fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id) end
                       || ' — approved cross-category transfer · ' || t.reason
       where be.project_id = t.project_id
         and be.event_type in ('budget_add', 'budget_update')
         and abs(be.delta_amount) = t.amount
         and be.created_at >= coalesce(t.in4_at, t.raised_at)
         and ((be.budget_line_id = v_f_line and be.delta_amount < 0)
           or (be.budget_line_id = v_t_line and be.delta_amount > 0))
       returning 1)
    select count(*) into v_hit from hit;

    -- No matching movement events means the change arrived some other way
    -- (a re-upload, a corrected figure). Note it on both lines rather than
    -- inventing deltas that never happened.
    if v_hit = 0 then
      insert into cc_budget_events (budget_line_id, project_id, event_type, delta_amount, remarks, channel, approval_status, event_date)
      select bl.id, t.project_id, 'budget_update', 0,
             'Cross-category transfer of ' || fn_inr(t.amount) || ' confirmed · ' || t.reason,
             'web', 'approved', now()
        from cc_budget_lines bl
       where bl.id in (v_f_line, v_t_line);
    end if;

    for v_who in
      select distinct u from (
        select t.raised_by u
        union select t.atm_by
        union select t.trustee_by
      ) s where u is not null
    loop
      perform notify_user(v_who, 'cc_transfer_confirmed',
        fn_inr(t.amount) || ' transfer confirmed · ' || v_proj,
        fn_inr(t.amount) || ' has moved out of ' || fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id)
          || ' and into ' || fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id) || '.'
          || chr(10) || chr(10) || v_settle,
        '/cost-control/projects/' || t.project_id::text, 'cost-control',
        'cc_budget_transfers', t.id);
    end loop;

    return 'confirmed';
  end if;

  -- Nothing has moved yet.
  if v_unmoved then
    update cc_budget_transfers
       set settle_note = 'Checked against IN4 — both lines are still unchanged, so the move has not come through yet.'
     where id = p_id;
    return 'awaiting_sync';
  end if;

  -- Something moved, but not this. The request deliberately stays open: a
  -- transfer that was approved and then executed differently is the case most
  -- worth surfacing.
  v_moved_f := v_from - coalesce(t.from_budget_at_in4, t.from_budget_at_raise, v_from);
  v_moved_t := v_to - coalesce(t.to_budget_at_in4, t.to_budget_at_raise, v_to);
  v_note := 'IN4 does not match what was approved. Expected ' || fn_inr(t.amount)
         || ' out and ' || fn_inr(t.amount) || ' in; the sync shows '
         || fn_inr(v_moved_f) || ' on ' || fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id)
         || ' and ' || fn_inr(v_moved_t) || ' on ' || fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id) || '.';

  update cc_budget_transfers set settle_note = v_note where id = p_id;

  for v_who in
    select distinct u from (
      select t.raised_by u
      union select t.in4_by
      union select pr.id from profiles pr
             where pr.is_active and effective_user_role(pr.id, 'cost-control') = 'coordinator'
    ) s where u is not null
  loop
    perform notify_user(v_who, 'cc_transfer_mismatch',
      'Transfer does not match IN4 · ' || v_proj,
      v_note || chr(10) || chr(10)
        || 'The request stays open until the two agree, so it cannot be quietly lost. '
        || 'Either correct IN4, or turn the request down and raise it again for the amount actually moved.',
      '/cost-control/projects/' || t.project_id::text, 'cost-control',
      'cc_budget_transfers', t.id);
  end loop;

  return 'awaiting_sync';
end $fn$;

-- Called after each BPH pull. Null project = every project.
create or replace function public.cc_transfer_verify(p_project uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare
  r        record;
  v_closed int := 0;
begin
  for r in
    select id from cc_budget_transfers
     where status = 'awaiting_sync'
       and (p_project is null or project_id = p_project)
     order by in4_at
  loop
    if cc_transfer_verify_one(r.id) = 'confirmed' then
      v_closed := v_closed + 1;
    end if;
  end loop;
  return v_closed;
end $fn$;

-- ============================================================
-- Reading it back
-- ============================================================

-- Every transfer touching one project, for the project screen. Definer so a
-- Coordinator with no project membership still sees them.
drop function if exists public.cc_project_transfers(uuid);
create or replace function public.cc_project_transfers(p_project uuid)
returns table (
  id uuid, status text, amount numeric, reason text,
  from_discipline_id uuid, from_sub_skill_id uuid, from_label text,
  to_discipline_id uuid, to_sub_skill_id uuid, to_label text,
  raised_at timestamptz, raised_by_name text, raised_by_me boolean,
  atm_at timestamptz, atm_by_name text, atm_comment text,
  trustee_at timestamptz, trustee_by_name text, trustee_comment text,
  in4_at timestamptz, in4_by_name text,
  confirmed_at timestamptz, settle_note text,
  closed_at timestamptz, closed_by_name text, closed_reason text
) language plpgsql stable security definer set search_path to 'public' as $fn$
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
         t.closed_at, coalesce(cp.full_name, cp.name, cp.email), t.closed_reason
    from cc_budget_transfers t
    left join profiles rp on rp.id = t.raised_by
    left join profiles ap on ap.id = t.atm_by
    left join profiles tp on tp.id = t.trustee_by
    left join profiles ip on ip.id = t.in4_by
    left join profiles cp on cp.id = t.closed_by
   where t.project_id = p_project
   order by t.raised_at desc;
end $fn$;

-- What is waiting on the person asking, for the approvals screen. Mirrors the
-- eligibility in cc_transfer_approve() exactly — a row that shows up here can
-- always be acted on, and one that cannot never appears.
create or replace function public.cc_transfer_inbox()
returns table (
  id uuid, project_id uuid, project_code text, project_name text,
  status text, stage text, amount numeric, reason text,
  from_label text, to_label text,
  raised_at timestamptz, raised_by_name text,
  atm_by_name text, atm_comment text
) language plpgsql stable security definer set search_path to 'public' as $fn$
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
         case when t.status = 'pending_atm' then 'Atm Head' else 'Trustee' end,
         t.amount, t.reason,
         fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id),
         fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id),
         t.raised_at, coalesce(rp.full_name, rp.name, rp.email),
         coalesce(ap.full_name, ap.name, ap.email), t.atm_comment
    from cc_budget_transfers t
    join projects pr on pr.id = t.project_id
    left join profiles rp on rp.id = t.raised_by
    left join profiles ap on ap.id = t.atm_by
   where t.status in ('pending_atm', 'pending_trustee')
     and (v_adm or t.raised_by is distinct from v_uid)
     and (
       (t.status = 'pending_atm' and (
          v_adm or v_role = 'head'
          or fn_cc_user_heads_discipline(v_uid, t.from_discipline_id)
          or fn_cc_user_heads_discipline(v_uid, t.to_discipline_id)
          or exists (select 1 from cc_project_approvers pa
                      where pa.project_id = t.project_id and pa.role = 'head' and pa.user_id = v_uid)))
       or (t.status = 'pending_trustee' and (v_adm or v_role = 'founder'))
     )
   order by t.raised_at;
end $fn$;

-- The IN4 worklist, alongside the two queues this person already works from.
-- Includes the ones already ticked and awaiting proof, so a move that IN4
-- never confirmed stays in front of them instead of vanishing on the tick.
create or replace function public.cc_transfer_in4_queue()
returns table (
  id uuid, project_id uuid, project_code text, project_name text,
  status text, amount numeric, reason text,
  from_label text, to_label text,
  approved_at timestamptz, trustee_by_name text,
  in4_at timestamptz, settle_note text
) language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  v_role := effective_user_role(v_uid, 'cost-control');
  if not (fn_cc_is_admin(v_uid) or v_role in ('billing', 'coordinator')) then
    raise exception 'This queue is for Billing and the Coordinator';
  end if;

  return query
  select t.id, t.project_id, pr.code, pr.name,
         t.status, t.amount, t.reason,
         fn_cc_line_label(t.from_discipline_id, t.from_sub_skill_id),
         fn_cc_line_label(t.to_discipline_id, t.to_sub_skill_id),
         t.trustee_at, coalesce(tp.full_name, tp.name, tp.email),
         t.in4_at, t.settle_note
    from cc_budget_transfers t
    join projects pr on pr.id = t.project_id
    left join profiles tp on tp.id = t.trustee_by
   where t.status in ('awaiting_in4', 'awaiting_sync')
   order by (t.status = 'awaiting_in4') desc, t.trustee_at;
end $fn$;

-- What the raise form needs to offer: every sub-category set up on the
-- project, with the budget on it and how much of that is actually free to
-- move away. Read-only, and gated the same way as the project screen.
create or replace function public.cc_transfer_line_options(p_project uuid)
returns table (
  discipline_id uuid, disc_code text, disc_name text,
  sub_skill_id uuid, sub_code text, sub_name text,
  budget numeric, free_to_move numeric, over_budget numeric,
  is_completed boolean
) language plpgsql stable security definer set search_path to 'public' as $fn$
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
  select d.id, d.code, d.name,
         ss.id, ss.code, ss.name,
         round(sum(coalesce(bl.current_budget_amt, 0))),
         fn_cc_transfer_free(p_project, d.id, ss.id),
         greatest(0, greatest(round(sum(coalesce(bl.current_paid_amt, 0))),
                              round(sum(coalesce(bl.current_wo_committed_amt, 0))))
                     - round(sum(coalesce(bl.current_budget_amt, 0)))),
         bool_or(ps.completed_at is not null)
    from cc_budget_lines bl
    join cc_sub_skills  ss on ss.id = bl.sub_skill_id
    join cc_disciplines d  on d.id  = bl.discipline_id
    left join cc_project_sub_skills ps
           on ps.project_id = bl.project_id and ps.sub_skill_id = bl.sub_skill_id
   where bl.project_id = p_project and bl.sub_skill_id is not null
   group by d.id, d.code, d.name, ss.id, ss.code, ss.name
   order by d.code, ss.code;
end $fn$;

grant execute on function public.cc_transfer_raise(uuid,uuid,uuid,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.cc_transfer_approve(uuid,text) to authenticated;
grant execute on function public.cc_transfer_reject(uuid,text) to authenticated;
grant execute on function public.cc_transfer_cancel(uuid) to authenticated;
grant execute on function public.cc_transfer_mark_in4(uuid) to authenticated;
grant execute on function public.cc_transfer_verify(uuid) to authenticated;
grant execute on function public.cc_project_transfers(uuid) to authenticated;
grant execute on function public.cc_transfer_inbox() to authenticated;
grant execute on function public.cc_transfer_in4_queue() to authenticated;
grant execute on function public.cc_transfer_line_options(uuid) to authenticated;
grant execute on function public.fn_cc_can_raise_transfer(uuid) to authenticated;
grant execute on function public.cc_can_i_raise_transfer() to authenticated;
grant execute on function public.fn_cc_transfer_free(uuid,uuid,uuid) to authenticated;
grant execute on function public.fn_cc_line_label(uuid,uuid) to authenticated;
grant execute on function public.fn_cc_line_budget(uuid,uuid,uuid) to authenticated;

-- cc_transfer_verify_one() and cc_transfer_notify_pending() are internals
-- called by the functions above; nothing in the app should reach them directly.
revoke all on function public.cc_transfer_verify_one(uuid) from authenticated;
revoke all on function public.cc_transfer_notify_pending(uuid) from authenticated;
