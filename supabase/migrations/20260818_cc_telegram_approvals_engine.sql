-- ============================================================================
-- Telegram budget approvals — the secure "act as the approver" engine.
--
-- A Telegram tap reaches our webhook with NO auth.uid() (there is no browser
-- session). These SECURITY DEFINER RPCs establish the approver's identity by
-- writing request.jwt.claim.sub TRANSACTION-LOCALLY, then run the EXACT live
-- approval engine unchanged:
--   • the enforce_approval_via_matrix trigger gates can_approve() as that person
--   • record_approval_event() re-checks the gate and stamps actor_id=auth.uid()
--   • cc_approve_release() runs its full money logic (locks, cumulative math,
--     [IB] exclusion, over-ask handling) as that person
-- No approval/money logic is duplicated here — it is the app's own engine, so
-- the Telegram path can never drift from the in-app path.
--
-- Security: EXECUTE is locked to service_role ONLY. A logged-in user must never
-- be able to call these with an arbitrary p_actor (that would be impersonation).
-- The webhook resolves p_actor server-side from the Telegram chat id Telegram
-- itself authenticated — never from anything the tapper can choose.
-- ============================================================================

-- When an approver taps "Approve" on a Project-Head / Atm-Head sheet, the bot
-- asks them to type the amount THEY checked (Option B — never a blind two-tap).
-- This row remembers what they were approving until their typed reply arrives.
create table if not exists public.tg_pending_approvals (
  id         uuid primary key default gen_random_uuid(),
  chat_id    text        not null,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  ws_id      uuid        not null references public.cc_working_sheets(id) on delete cascade,
  action     text        not null check (action in ('signoff','release')),
  stage      text        not null,                     -- from-stage captured at tap time
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);
create index if not exists tg_pending_approvals_chat_idx
  on public.tg_pending_approvals(chat_id, created_at desc);
-- Only the service role / SECURITY DEFINER code touches this — deny everyone else.
alter table public.tg_pending_approvals enable row level security;

-- ── Stage 1 & 2: Project Head / Atm Head sign-off ──────────────────────────
-- Mirrors components/cost-control/ws-actions.ts:signOffWorkingSheet exactly:
-- derives the target stage from the current status, blocks self-approval,
-- honours per-project named approvers, performs the same status + checked-amount
-- UPDATE (the matrix trigger enforces the role gate), and logs the same event.
create or replace function public.cc_tg_signoff(
  p_actor       uuid,
  p_ws_id       uuid,
  p_checked_amt numeric,
  p_note        text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ws      public.cc_working_sheets%rowtype;
  v_to      text;
  v_role    text;
  v_named   int;
  v_now     timestamptz := now();
  v_comment text;
begin
  if p_actor is null then raise exception 'No approver identified'; end if;
  if p_checked_amt is null or p_checked_amt <= 0 then
    raise exception 'Type the amount you checked before signing off';
  end if;

  -- Become the approver for the rest of this (single-statement RPC) transaction.
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);

  select * into v_ws from public.cc_working_sheets where id = p_ws_id for update;
  if not found then raise exception 'Working Sheet not found'; end if;

  v_to := case v_ws.status::text
            when 'submitted'   then 'ph_approved'
            when 'ph_approved' then 'atm_approved'
            else null end;
  if v_to is null then
    raise exception 'This sheet is not waiting for a sign-off right now';
  end if;

  -- Self-approval block (the matrix trigger does NOT check raiser vs approver).
  if v_ws.engineer_id = p_actor and not public.fn_cc_is_admin(p_actor) then
    raise exception 'You cannot sign off a sheet you raised yourself';
  end if;

  -- Per-project named-approver gate (mirrors projectApproverAllows): when this
  -- project names approvers for the covering role, only they (or an admin) act.
  if not public.fn_cc_is_admin(p_actor) then
    v_role := case v_ws.status::text when 'submitted' then 'project_head'
                                     when 'ph_approved' then 'head' end;
    select count(*) into v_named from public.cc_project_approvers
      where project_id = v_ws.project_id and role = v_role;
    if v_named > 0 and not exists (
      select 1 from public.cc_project_approvers
      where project_id = v_ws.project_id and role = v_role and user_id = p_actor
    ) then
      raise exception 'This stage is assigned to a specific approver for this project — it is not with you';
    end if;
  end if;

  -- The transition. BEFORE-UPDATE trg_cc_working_sheets_matrix runs
  -- can_approve(actor) for from->to and raises if the actor's role isn't
  -- configured — identical gate to the app.
  update public.cc_working_sheets set
    status          = v_to::cc_ws_status,
    ph_checked_amt  = case when v_to = 'ph_approved'  then p_checked_amt else ph_checked_amt end,
    ph_checked_at   = case when v_to = 'ph_approved'  then v_now         else ph_checked_at end,
    ph_checked_by   = case when v_to = 'ph_approved'  then p_actor       else ph_checked_by end,
    atm_checked_amt = case when v_to = 'atm_approved' then p_checked_amt else atm_checked_amt end,
    atm_checked_at  = case when v_to = 'atm_approved' then v_now         else atm_checked_at end,
    atm_checked_by  = case when v_to = 'atm_approved' then p_actor       else atm_checked_by end
  where id = p_ws_id and status = v_ws.status;
  if not found then
    raise exception 'Sign-off not applied — the sheet may have already moved';
  end if;

  v_comment := 'Checked ' || public.fn_inr(p_checked_amt)
    || coalesce(' — ' || nullif(btrim(p_note), ''), '')
    || ' · via Telegram';

  perform public.record_approval_event(
    'cost-control', 'cc_working_sheet', 'cc_working_sheets', p_ws_id,
    v_ws.status::text, v_to, 'approved', v_comment, '[]'::jsonb, null);

  return jsonb_build_object('ok', true, 'new_status', v_to, 'ws_code', v_ws.ws_code);
end $$;

-- ── Stage 3: Trustee release into ERP ──────────────────────────────────────
-- Mirrors approveWorkingSheet: friendly pre-checks, then hands the whole
-- money transaction to cc_approve_release (unchanged) running as the actor.
create or replace function public.cc_tg_release(
  p_actor   uuid,
  p_ws_id   uuid,
  p_tranche numeric default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ws  public.cc_working_sheets%rowtype;
  v_res jsonb;
begin
  if p_actor is null then raise exception 'No approver identified'; end if;

  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);

  select * into v_ws from public.cc_working_sheets where id = p_ws_id;
  if not found then raise exception 'Working Sheet not found'; end if;
  if v_ws.status::text not in ('atm_approved', 'partially_approved') then
    raise exception 'Only sheets signed off by the Atm Head (or already partially released) can be released';
  end if;

  -- Named-approver gate for the Trustee (founder) stage.
  if not public.fn_cc_is_admin(p_actor)
     and exists (select 1 from public.cc_project_approvers
                 where project_id = v_ws.project_id and role = 'founder')
     and not exists (select 1 from public.cc_project_approvers
                     where project_id = v_ws.project_id and role = 'founder' and user_id = p_actor) then
    raise exception 'This project''s release is assigned to a specific Trustee — it is not with you';
  end if;

  -- Full money logic (row lock, cumulative across versions, [IB] exclusion,
  -- over-ask, budget event) — as the actor.
  v_res := public.cc_approve_release(p_ws_id, p_tranche);
  return v_res || jsonb_build_object('ws_code', v_ws.ws_code);
end $$;

-- Impersonation lock-down: ONLY the service role (the webhook) may call these.
revoke all on function public.cc_tg_signoff(uuid, uuid, numeric, text) from public;
revoke all on function public.cc_tg_release(uuid, uuid, numeric)        from public;
grant execute on function public.cc_tg_signoff(uuid, uuid, numeric, text) to service_role;
grant execute on function public.cc_tg_release(uuid, uuid, numeric)        to service_role;

comment on function public.cc_tg_signoff(uuid, uuid, numeric, text) is
  'Telegram PH/Atm sign-off: runs the live approval engine as p_actor. service_role only.';
comment on function public.cc_tg_release(uuid, uuid, numeric) is
  'Telegram Trustee release: runs cc_approve_release as p_actor. service_role only.';
