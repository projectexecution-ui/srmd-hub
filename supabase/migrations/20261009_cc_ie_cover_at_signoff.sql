-- Internal Estimate is checked and covered at sign-off (Aksha, 9 Oct 2026).
--
-- When the Project Head or the Atm Head signs off a budget request, the
-- sub-category's Internal Estimate must cover it. If it does not, the person
-- signing off covers the gap first — by taking spare Internal Estimate from
-- another sub-category of the SAME category, or by adding new Internal
-- Estimate — and only then can the request go ahead. No Trustee approval for
-- the Internal Estimate change itself (Aksha's call).
--
-- "Spare" = the sub-category's Internal Estimate − what is already approved
-- on it − what other requests still waiting on it ask for. The arithmetic is
-- the same one the screens use (lib/cost-control/project-rollup.ts): latest
-- version per chain, [IB…] baseline sheets give the estimate, a figure set on
-- the budget line wins over the baseline.
--
-- Internal Estimate stays management-only: nothing here is readable by an
-- engineer. Additive and idempotent: one new table, five new functions, one
-- new trigger; cc_bl_gate_estimate gains one allowance (writes made through
-- cc_ie_cover), nothing else changes.

-- 1. The log — every move or addition made at sign-off. -----------------------
create table if not exists public.cc_ie_moves (
  id                uuid primary key default gen_random_uuid(),
  ws_id             uuid not null references public.cc_working_sheets(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  discipline_id     uuid not null,
  from_sub_skill_id uuid,                -- null = new Internal Estimate, taken from nowhere
  to_sub_skill_id   uuid not null,
  amount            numeric not null check (amount > 0),
  from_before       numeric,
  from_after        numeric,
  to_before         numeric not null,
  to_after          numeric not null,
  stage             text not null check (stage in ('project_head', 'atm_head', 'admin')),
  actor_id          uuid not null,
  note              text not null,
  created_at        timestamptz not null default now()
);
create index if not exists cc_ie_moves_ws_idx on public.cc_ie_moves (ws_id, created_at);
create index if not exists cc_ie_moves_project_idx on public.cc_ie_moves (project_id, discipline_id);

alter table public.cc_ie_moves enable row level security;
drop policy if exists cc_ie_moves_select on public.cc_ie_moves;
create policy cc_ie_moves_select on public.cc_ie_moves for select to authenticated
  using (
    public.fn_cc_is_reviewer((select auth.uid()))
    or public.effective_user_role((select auth.uid()), 'cost-control')::text = 'coordinator'
  );
-- Written only through cc_ie_cover (security definer).
revoke insert, update, delete on public.cc_ie_moves from anon, authenticated;

-- 2. The arithmetic, per sub-category of one category. --------------------------
-- Internal only (exposes Internal Estimate): no client may call it directly.
create or replace function public.fn_cc_ie_rows(p_project uuid, p_discipline uuid)
returns table (sub_skill_id uuid, ie numeric, ie_set boolean, approved numeric, pending numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  with v as (
    select w.id,
           w.sub_skill_id,
           w.status::text                                  as status,
           coalesce(w.total_amount, 0)                     as amt,
           coalesce(w.approved_for_erp_amt, 0)             as appr,
           coalesce(w.summary_notes, '') like '[IB%'       as is_ib,
           coalesce(w.chain_anchor_id, w.id)               as anchor,
           coalesce(w.version_no, 1)                       as ver,
           w.created_at
      from public.cc_ws_with_versions w
     where w.project_id = p_project
       and w.discipline_id = p_discipline
       and w.sub_skill_id is not null
       and w.status::text <> 'cancelled'
  ),
  latest as (
    select distinct on (is_ib, anchor) *
      from v
     order by is_ib, anchor, ver desc, created_at desc
  ),
  released as (
    select anchor, max(appr) as rel from v where not is_ib group by anchor
  ),
  plan as (
    select sub_skill_id, sum(amt) as plan from latest where is_ib group by sub_skill_id
  ),
  eng as (
    select l.sub_skill_id,
           sum(case
                 when l.status in ('approved', 'wo_issued', 'paid') then
                   case when greatest(r.rel, l.appr) > 0 then greatest(r.rel, l.appr, l.amt) else l.amt end
                 else greatest(r.rel, l.appr)
               end) as approved,
           sum(case
                 when l.status in ('partially_approved', 'submitted', 'ph_approved', 'atm_approved')
                   then greatest(l.amt - greatest(r.rel, l.appr), 0)
                 else 0
               end) as pending
      from latest l
      join released r on r.anchor = l.anchor
     where not l.is_ib
     group by l.sub_skill_id
  ),
  lines as (
    select bl.sub_skill_id,
           sum(bl.internal_estimate_amt)                  as ie,
           bool_or(bl.internal_estimate_amt is not null)  as has_ie
      from public.cc_budget_lines bl
     where bl.project_id = p_project
       and bl.discipline_id = p_discipline
       and bl.sub_skill_id is not null
     group by bl.sub_skill_id
  ),
  subs as (
    select sub_skill_id from plan
    union select sub_skill_id from eng
    union select sub_skill_id from lines
  )
  select s.sub_skill_id,
         round(case when coalesce(ln.has_ie, false) then coalesce(ln.ie, 0) else coalesce(p.plan, 0) end),
         coalesce(ln.has_ie, false),
         round(coalesce(e.approved, 0)),
         round(coalesce(e.pending, 0))
    from subs s
    left join plan  p  on p.sub_skill_id  = s.sub_skill_id
    left join eng   e  on e.sub_skill_id  = s.sub_skill_id
    left join lines ln on ln.sub_skill_id = s.sub_skill_id;
$$;
revoke execute on function public.fn_cc_ie_rows(uuid, uuid) from public, anon, authenticated;

-- 3. Who may cover the gap on a request: whoever may sign it off right now. -----
-- Returns null when allowed, else the reason in plain words.
create or replace function public.fn_cc_ie_cover_block(p_ws uuid, p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ws    public.cc_working_sheets%rowtype;
  v_to    text;
  v_role  text;
  v_named int;
begin
  if p_user is null then return 'Not signed in'; end if;
  select * into v_ws from public.cc_working_sheets where id = p_ws;
  if not found then return 'Budget request not found'; end if;
  if v_ws.sub_skill_id is null or v_ws.discipline_id is null then
    return 'This request has no sub-category';
  end if;
  v_to := case v_ws.status::text when 'submitted' then 'ph_approved' when 'ph_approved' then 'atm_approved' end;
  if v_to is null then
    return 'Internal Estimate is covered while the request waits for the Project Head or the Atm Head';
  end if;
  if public.fn_cc_is_admin(p_user) then return null; end if;
  if v_ws.engineer_id = p_user then return 'You cannot do this on a request you raised'; end if;
  if not public.can_approve('cost-control', 'cc_working_sheet', v_ws.status::text, v_to, null) then
    return 'Only the person who signs off this stage can cover the Internal Estimate';
  end if;
  v_role := case v_ws.status::text when 'submitted' then 'project_head' else 'head' end;
  select count(*) into v_named from public.cc_project_approvers
   where project_id = v_ws.project_id and role = v_role;
  if v_named > 0 and not exists (
    select 1 from public.cc_project_approvers
     where project_id = v_ws.project_id and role = v_role and user_id = p_user
  ) then
    return 'This stage is assigned to a specific approver for this project — it is not with you';
  end if;
  return null;
end $$;
revoke execute on function public.fn_cc_ie_cover_block(uuid, uuid) from public, anon, authenticated;

-- 4. Where the request stands against the Internal Estimate. ------------------
-- For the Budget position panel and the sign-off box. Management only.
create or replace function public.cc_ie_position(p_ws uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_ws      public.cc_working_sheets%rowtype;
  v_applies boolean;
  v_this    record;
  v_short   numeric := 0;
  v_rows    jsonb;
  v_moves   jsonb;
  v_disc    text;
  v_block   text;
begin
  if v_uid is null
     or not (public.fn_cc_is_reviewer(v_uid)
             or public.effective_user_role(v_uid, 'cost-control')::text = 'coordinator') then
    raise exception 'Internal Estimate is visible to approvers only';
  end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws;
  if not found then raise exception 'Budget request not found'; end if;

  v_applies := v_ws.sub_skill_id is not null and v_ws.discipline_id is not null and v_ws.project_id is not null
               and coalesce(v_ws.summary_notes, '') not like '[IB%';
  if not v_applies then
    return jsonb_build_object('applies', false);
  end if;

  select coalesce(code || ' ', '') || name into v_disc from public.cc_disciplines where id = v_ws.discipline_id;

  select r.* into v_this
    from public.fn_cc_ie_rows(v_ws.project_id, v_ws.discipline_id) r
   where r.sub_skill_id = v_ws.sub_skill_id;
  v_short := greatest(round(coalesce(v_this.approved, 0) + coalesce(v_this.pending, 0) - coalesce(v_this.ie, 0)), 0);

  select coalesce(jsonb_agg(jsonb_build_object(
           'sub_skill_id', r.sub_skill_id,
           'code', ss.code,
           'name', ss.name,
           'ie', r.ie,
           'ie_set', r.ie_set,
           'approved', r.approved,
           'pending', r.pending,
           'spare', r.ie - r.approved - r.pending,
           'is_this', r.sub_skill_id = v_ws.sub_skill_id)
         order by ss.code nulls last, ss.name), '[]'::jsonb)
    into v_rows
    from public.fn_cc_ie_rows(v_ws.project_id, v_ws.discipline_id) r
    left join public.cc_sub_skills ss on ss.id = r.sub_skill_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'at', m.created_at,
           'actor', coalesce(p.full_name, p.name, p.email),
           'from', case when m.from_sub_skill_id is null then null else coalesce(fs.code || ' ', '') || fs.name end,
           'to', coalesce(ts.code || ' ', '') || ts.name,
           'amount', m.amount,
           'stage', m.stage,
           'note', m.note)
         order by m.created_at), '[]'::jsonb)
    into v_moves
    from public.cc_ie_moves m
    left join public.profiles p      on p.id  = m.actor_id
    left join public.cc_sub_skills fs on fs.id = m.from_sub_skill_id
    left join public.cc_sub_skills ts on ts.id = m.to_sub_skill_id
   where m.ws_id = p_ws;

  v_block := public.fn_cc_ie_cover_block(p_ws, v_uid);

  return jsonb_build_object(
    'applies', true,
    'status', v_ws.status::text,
    'sub_skill_id', v_ws.sub_skill_id,
    'discipline', v_disc,
    'ie', coalesce(v_this.ie, 0),
    'ie_set', coalesce(v_this.ie_set, false),
    'approved', coalesce(v_this.approved, 0),
    'pending', coalesce(v_this.pending, 0),
    'ask', greatest(round(coalesce(v_ws.total_amount, 0) - coalesce(v_ws.approved_for_erp_amt, 0)), 0),
    'shortfall', v_short,
    'can_cover', v_block is null,
    'cover_block', v_block,
    'rows', v_rows,
    'moves', v_moves);
end $$;
revoke execute on function public.cc_ie_position(uuid) from public, anon;
grant execute on function public.cc_ie_position(uuid) to authenticated;

-- 5. Write one sub-category's Internal Estimate (internal). ----------------------
-- One budget line per sub-category today (all line_type 'work'); if several ever
-- exist, the chosen row takes the target minus what the others hold, so the
-- total still reads as the target.
create or replace function public.fn_cc_ie_set_line(
  p_project uuid, p_discipline uuid, p_sub_skill uuid, p_amount numeric, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid; v_others numeric;
begin
  perform set_config('cc.ie_cover', 'on', true);
  select id into v_id from public.cc_budget_lines
   where project_id = p_project and discipline_id = p_discipline and sub_skill_id = p_sub_skill
   order by (line_type::text = 'work') desc, created_at
   limit 1;
  if v_id is null then
    insert into public.cc_budget_lines
      (project_id, discipline_id, sub_skill_id, line_type, internal_estimate_amt, internal_estimate_notes)
    values (p_project, p_discipline, p_sub_skill, 'work', round(p_amount), p_note);
  else
    select coalesce(sum(internal_estimate_amt), 0) into v_others from public.cc_budget_lines
     where project_id = p_project and discipline_id = p_discipline and sub_skill_id = p_sub_skill and id <> v_id;
    update public.cc_budget_lines
       set internal_estimate_amt = round(p_amount) - v_others,
           internal_estimate_notes = p_note,
           updated_at = now()
     where id = v_id;
  end if;
  perform set_config('cc.ie_cover', 'off', true);
end $$;
revoke execute on function public.fn_cc_ie_set_line(uuid, uuid, uuid, numeric, text) from public, anon, authenticated;

-- 6. The estimate gate on budget lines lets cc_ie_cover's own writes through. --
-- Same body as before plus the one allowance; the audit stamp (set_at / set_by
-- = the person covering) is applied exactly as for a Trustee-set figure.
create or replace function public.cc_bl_gate_estimate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_allowed boolean;
begin
  if (tg_op = 'INSERT' and new.internal_estimate_amt is not null)
  or (tg_op = 'UPDATE' and (new.internal_estimate_amt is distinct from old.internal_estimate_amt
                            or new.internal_estimate_notes is distinct from old.internal_estimate_notes))
  then
    v_allowed := coalesce(current_setting('cc.ie_cover', true), '') = 'on'
              or public.can_approve('cost-control','cc_budget_line','any','estimate_set', null);
    if not coalesce(v_allowed, false) then
      new.internal_estimate_amt    := case when tg_op = 'INSERT' then null else old.internal_estimate_amt end;
      new.internal_estimate_notes  := case when tg_op = 'INSERT' then null else old.internal_estimate_notes end;
      new.internal_estimate_set_at := case when tg_op = 'INSERT' then null else old.internal_estimate_set_at end;
      new.internal_estimate_set_by := case when tg_op = 'INSERT' then null else old.internal_estimate_set_by end;
    else
      -- Stamp the audit fields automatically
      if (tg_op = 'INSERT' and new.internal_estimate_amt is not null)
      or (tg_op = 'UPDATE' and new.internal_estimate_amt is distinct from old.internal_estimate_amt)
      then
        new.internal_estimate_set_at := now();
        new.internal_estimate_set_by := auth.uid();
      end if;
    end if;
  end if;
  return new;
end $function$;

-- 7. Cover the gap: take from the same category and/or add new. -----------------
-- p_moves = [{"sub_skill_id": "...", "amount": 1234}, ...]  (same category only)
-- p_new   = new Internal Estimate added to this sub-category (0 for none)
-- p_note  = why — kept in the log, required.
create or replace function public.cc_ie_cover(p_ws uuid, p_moves jsonb, p_new numeric default 0, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_ws       public.cc_working_sheets%rowtype;
  v_block    text;
  v_stage    text;
  v_who      text;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_item     jsonb;
  v_from     uuid;
  v_amt      numeric;
  v_new      numeric := round(coalesce(p_new, 0));
  v_in       numeric := 0;
  v_to_ie    numeric;
  v_running  numeric;
  r_from     record;
  v_to_label text;
  v_from_lbl text;
  v_seen     uuid[] := '{}';
begin
  v_block := public.fn_cc_ie_cover_block(p_ws, v_uid);
  if v_block is not null then raise exception '%', v_block; end if;
  if v_note is null or length(v_note) < 3 then
    raise exception 'Add a short reason for the Internal Estimate change';
  end if;
  if v_new < 0 then raise exception 'New Internal Estimate cannot be negative'; end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws for update;
  -- One cover at a time per category: moves between siblings must not race.
  perform pg_advisory_xact_lock(hashtext('cc_ie_cover:' || v_ws.project_id::text || ':' || v_ws.discipline_id::text));

  v_stage := case when public.fn_cc_is_admin(v_uid) and not exists (
                      select 1 from public.cc_project_approvers
                       where project_id = v_ws.project_id and user_id = v_uid
                         and role = case v_ws.status::text when 'submitted' then 'project_head' else 'head' end)
                  then 'admin'
                  when v_ws.status::text = 'submitted' then 'project_head'
                  else 'atm_head' end;
  select coalesce(full_name, name, email) into v_who from public.profiles where id = v_uid;
  select coalesce(code || ' ', '') || name into v_to_label from public.cc_sub_skills where id = v_ws.sub_skill_id;

  select r.ie into v_to_ie
    from public.fn_cc_ie_rows(v_ws.project_id, v_ws.discipline_id) r
   where r.sub_skill_id = v_ws.sub_skill_id;
  v_to_ie := coalesce(v_to_ie, 0);
  v_running := v_to_ie;

  -- Take from siblings in the same category, never more than their spare.
  for v_item in select * from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) loop
    v_from := nullif(v_item ->> 'sub_skill_id', '')::uuid;
    v_amt  := round(coalesce((v_item ->> 'amount')::numeric, 0));
    if v_from is null or v_amt <= 0 then continue; end if;
    if v_from = any (v_seen) then raise exception 'Each sub-category can be taken from once per change'; end if;
    v_seen := v_seen || v_from;
    if v_from = v_ws.sub_skill_id then raise exception 'Pick another sub-category to take from'; end if;
    if not exists (select 1 from public.cc_sub_skills where id = v_from and discipline_id = v_ws.discipline_id) then
      raise exception 'Internal Estimate can only be taken from the same category';
    end if;
    select r.* into r_from
      from public.fn_cc_ie_rows(v_ws.project_id, v_ws.discipline_id) r
     where r.sub_skill_id = v_from;
    select coalesce(code || ' ', '') || name into v_from_lbl from public.cc_sub_skills where id = v_from;
    if r_from.sub_skill_id is null or (r_from.ie - r_from.approved - r_from.pending) < v_amt then
      raise exception '% has only % spare Internal Estimate',
        coalesce(v_from_lbl, 'That sub-category'),
        public.fn_inr(greatest(coalesce(r_from.ie - r_from.approved - r_from.pending, 0), 0));
    end if;

    perform public.fn_cc_ie_set_line(v_ws.project_id, v_ws.discipline_id, v_from, r_from.ie - v_amt,
      'Moved ' || public.fn_inr(v_amt) || ' to ' || coalesce(v_to_label, 'another sub-category')
      || ' for ' || coalesce(v_ws.ws_code, 'a budget request') || ' — ' || coalesce(v_who, 'approver')
      || ', ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY'));

    insert into public.cc_ie_moves
      (ws_id, project_id, discipline_id, from_sub_skill_id, to_sub_skill_id, amount,
       from_before, from_after, to_before, to_after, stage, actor_id, note)
    values
      (p_ws, v_ws.project_id, v_ws.discipline_id, v_from, v_ws.sub_skill_id, v_amt,
       r_from.ie, r_from.ie - v_amt, v_running, v_running + v_amt, v_stage, v_uid, v_note);
    v_running := v_running + v_amt;
    v_in := v_in + v_amt;
  end loop;

  if v_new > 0 then
    insert into public.cc_ie_moves
      (ws_id, project_id, discipline_id, from_sub_skill_id, to_sub_skill_id, amount,
       from_before, from_after, to_before, to_after, stage, actor_id, note)
    values
      (p_ws, v_ws.project_id, v_ws.discipline_id, null, v_ws.sub_skill_id, v_new,
       null, null, v_running, v_running + v_new, v_stage, v_uid, v_note);
    v_running := v_running + v_new;
    v_in := v_in + v_new;
  end if;

  if v_in <= 0 then raise exception 'Enter an amount to take or to add'; end if;

  perform public.fn_cc_ie_set_line(v_ws.project_id, v_ws.discipline_id, v_ws.sub_skill_id, v_running,
    'Raised from ' || public.fn_inr(v_to_ie) || ' to ' || public.fn_inr(v_running)
    || ' for ' || coalesce(v_ws.ws_code, 'a budget request') || ' — ' || coalesce(v_who, 'approver')
    || ', ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY'));

  return public.cc_ie_position(p_ws);
end $$;
revoke execute on function public.cc_ie_cover(uuid, jsonb, numeric, text) from public, anon;
grant execute on function public.cc_ie_cover(uuid, jsonb, numeric, text) to authenticated;

-- 8. The gate: no Project Head / Atm Head sign-off while the gap is open. --------
-- Covers every path that moves a request into ph_approved / atm_approved — the
-- request page, the bulk thumb-rule page and Telegram (cc_tg_signoff). System
-- writes with no signed-in person (auth.uid() null) are not gated.
create or replace function public.fn_cc_ws_ie_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ie     numeric;
  v_appr   numeric;
  v_pend   numeric;
  v_extra  numeric := 0;
  v_short  numeric;
  v_sub    text;
  v_disc   text;
begin
  if auth.uid() is null then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if not (
       (new.status::text = 'ph_approved'  and old.status::text in ('draft', 'draft_blocked', 'submitted', 'returned'))
    or (new.status::text = 'atm_approved' and old.status::text in ('draft', 'draft_blocked', 'submitted', 'returned', 'ph_approved'))
  ) then
    return new;
  end if;
  if coalesce(new.summary_notes, '') like '[IB%'
     or new.sub_skill_id is null or new.discipline_id is null or new.project_id is null then
    return new;
  end if;

  select r.ie, r.approved, r.pending into v_ie, v_appr, v_pend
    from public.fn_cc_ie_rows(new.project_id, new.discipline_id) r
   where r.sub_skill_id = new.sub_skill_id;

  -- A request coming straight from draft / returned is not yet counted as
  -- waiting, so its own ask is added here.
  if old.status::text not in ('submitted', 'ph_approved', 'atm_approved', 'partially_approved') then
    v_extra := greatest(coalesce(new.total_amount, 0) - coalesce(new.approved_for_erp_amt, 0), 0);
  end if;

  v_short := round(coalesce(v_appr, 0) + coalesce(v_pend, 0) + v_extra - coalesce(v_ie, 0));
  if v_short >= 1 then
    select coalesce(code || ' ', '') || name into v_sub  from public.cc_sub_skills  where id = new.sub_skill_id;
    select coalesce(code || ' ', '') || name into v_disc from public.cc_disciplines where id = new.discipline_id;
    raise exception 'Internal Estimate is short by % on %. Before signing off, take it from another sub-category of % or add new Internal Estimate — under Budget position on this request.',
      public.fn_inr(v_short), coalesce(v_sub, 'this sub-category'), coalesce(v_disc, 'the same category');
  end if;
  return new;
end $$;
revoke execute on function public.fn_cc_ws_ie_gate() from public, anon, authenticated;

drop trigger if exists trg_cc_ws_ie_gate on public.cc_working_sheets;
create trigger trg_cc_ws_ie_gate
  before update of status on public.cc_working_sheets
  for each row execute function public.fn_cc_ws_ie_gate();
