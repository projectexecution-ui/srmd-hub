-- Ten example bills to walk the flow on, and one button to remove them.
--
-- Aksha, 14 Sep 2026: "i would like u to make few 10 Live Examples - simple and
-- complex in the Admin page which i can check and review and then we decide to
-- remove."
--
-- bb_bills holds three real records. There is no way to judge a flow from
-- three, and nobody wants to learn a new approval chain by typing ten bills by
-- hand first. So: ten, drawn from REAL IN4 work orders so the figures behave
-- like real ones, sitting at different desks and carrying the awkward cases —
-- over the work-order value, no WO yet, a building CT Hub has no project for,
-- held, rejected, paid.
--
-- Two rules they have to obey, because a demo row that gets mistaken for money
-- is worse than no demo at all:
--
--   · `is_example` is on the row, not in the title. Every screen can then
--     exclude them from the totals rather than relying on somebody noticing a
--     name, and the badge is drawn from the same flag people filter on.
--   · Removing them is one button and takes everything with it — the bills,
--     their events, their sanctions. Aksha said "then we decide to remove", so
--     removal must not be an archaeology exercise.

alter table public.bb_bills
  add column if not exists is_example boolean not null default false;

comment on column public.bb_bills.is_example is
  'A seeded walkthrough bill. Excluded from every money total, badged on screen, and removable in one click from /bills-booking/admin.';

create index if not exists bb_bills_example_idx on public.bb_bills (is_example) where is_example;

-- ── remove them all ────────────────────────────────────────────────────────
-- bb_bills has no delete policy for any user, deliberately — everything goes
-- through a definer function. Events and documents cascade if the constraints
-- say so; they are deleted explicitly here so this does not depend on that.
create or replace function public.bb_rpc_clear_examples()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles pr
                 where pr.id = auth.uid() and rp.role = pr.role
                   and rp.module_slug = 'bills-booking' and rp.can_admin = true) then
    raise exception 'Only a Bills Approval admin can clear the examples';
  end if;

  delete from public.bb_bill_events e
   where e.bill_id in (select id from public.bb_bills where is_example);
  delete from public.bb_bill_docs d
   where d.bill_id in (select id from public.bb_bills where is_example);
  delete from public.bb_bills where is_example;
  get diagnostics v_n = row_count;

  return jsonb_build_object('status','ok','removed', v_n);
end $function$;

-- ── put one in ─────────────────────────────────────────────────────────────
-- One row at a time, so the seeder can compose the ten in application code
-- where the work orders are read from IN4, rather than hard-coding ids in SQL
-- that will be wrong on any other database.
create or replace function public.bb_rpc_add_example(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_stage bb_stage; v_since timestamptz;
begin
  if not exists (select 1 from public.role_permissions rp, public.profiles pr
                 where pr.id = v_actor and rp.role = pr.role
                   and rp.module_slug = 'bills-booking' and rp.can_admin = true) then
    raise exception 'Only a Bills Approval admin can add examples';
  end if;

  v_stage := coalesce(nullif(p->>'stage',''), 'submitted')::bb_stage;
  -- Sat at this desk for a believable number of days, so the waiting columns
  -- and the SLA colouring have something to show.
  v_since := now() - (coalesce((p->>'days_at_desk')::int, 0) || ' days')::interval;

  insert into public.bb_bills(
    order_type, bill_type, order_no, project_id, in4_subproject_id, vendor_text,
    discipline, discipline_id, work, bill_no, ra_no, bill_date, claimed_amount, net_amount,
    trust, wo_value, paid_till_date, ct_other_dept, abstract_no_in4,
    wo_pending, amendment_flag, current_stage, stage_since, is_example, created_by)
  values (
    coalesce(nullif(p->>'order_type',''), 'WO'),
    nullif(p->>'bill_type',''), nullif(p->>'order_no',''),
    nullif(p->>'project_id','')::uuid, nullif(p->>'in4_subproject_id','')::integer,
    nullif(p->>'vendor_text',''),
    nullif(p->>'discipline',''), nullif(p->>'discipline_id','')::uuid,
    nullif(p->>'work',''), nullif(p->>'bill_no',''), nullif(p->>'ra_no',''),
    nullif(p->>'bill_date','')::date,
    coalesce((p->>'claimed_amount')::numeric, 0),
    nullif(p->>'net_amount','')::numeric,
    nullif(p->>'trust',''),
    nullif(p->>'wo_value','')::numeric,
    coalesce((p->>'paid_till_date')::numeric, 0),
    coalesce(nullif(p->>'ct_other_dept',''), 'CT'),
    nullif(p->>'abstract_no_in4',''),
    coalesce((p->>'wo_pending')::boolean, false),
    coalesce((p->>'amendment_flag')::boolean, false),
    v_stage, v_since, true, v_actor)
  returning id into v_id;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id, created_at)
  values (v_id, null, 'submitted', 'forward',
          coalesce(nullif(p->>'note',''), 'Example bill, seeded for the walkthrough'),
          coalesce((p->>'claimed_amount')::numeric, 0), v_actor, v_since);

  -- A bill that is not at the first desk got there somehow; one more event so
  -- the history is not a single line that contradicts the stage pill.
  if v_stage <> 'submitted' then
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id, created_at)
    values (v_id, 'submitted', v_stage, 'forward', 'Moved along for the walkthrough',
            coalesce((p->>'claimed_amount')::numeric, 0), v_actor, v_since);
  end if;

  return v_id;
end $function$;

grant execute on function public.bb_rpc_clear_examples() to authenticated;
grant execute on function public.bb_rpc_add_example(jsonb) to authenticated;
