-- The document checklist at the Site Head. Applied live on 15 Oct 2026.
--
-- Ambrish (Engineer, SRM) on the go-live guide, 14 Oct 2026: a mandatory
-- document checklist at the Site Head step. Aksha chose (a): the bill WAITS
-- at the Site Head until the documents are attached — and the list depends on
-- the kind of bill ("Final only have No due, VCC, etc - other have MB sheet").
-- If the Site Head does not attach one, he must give a reason; the CT Disc
-- Head, the Project Head and the Atm Head are told, and only then does the
-- bill move. The Disc Head's job is to check, not to attach.
--
-- ONE SOURCE OF TRUTH. The checklist lives in bb_doc_checklist() below and
-- nowhere else: the Forward gate, the register's "waiting on documents" tag,
-- the bill page and the phone summary all read it. A list copied into
-- TypeScript would drift the first time somebody edited one of them.
--
-- What is NOT asked for as an upload: the abstract (WO) or goods receipt (PO).
-- CT Hub reads those straight from IN4, and the Site Head already has to pick
-- the approved one before Forward unlocks — asking for a PDF of it as well
-- would be the same document twice.
--
-- The checklist, by kind of bill:
--   every bill                       stamped bill / invoice
--   Running (WO)                     + certified RA measurement sheet (cumulative)
--                                    + marking plan / as-built drawing
--   Full & Final (WO)                + those two
--                                    + No-Due certificate
--                                    + Virtual Completion Certificate
--                                    + Warranty / guarantee certificate or bond
--   PO bills, Advance, Petty Cash,
--   Misc, Retention release          stamped bill only
--
-- The existing "Full & Final needs the No-Due certificate" switch in Bills
-- settings still governs the No-Due line, so that screen stays truthful.

-- ── the reasons ─────────────────────────────────────────────────────────────
create table if not exists public.bb_bill_doc_waivers (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.bb_bills(id) on delete cascade,
  kind        text not null,
  reason      text not null,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  unique (bill_id, kind)
);
alter table public.bb_bill_doc_waivers enable row level security;
drop policy if exists bb_doc_waivers_select on public.bb_bill_doc_waivers;
create policy bb_doc_waivers_select on public.bb_bill_doc_waivers
  for select to authenticated
  using (exists (select 1 from public.bb_bills b where b.id = bb_bill_doc_waivers.bill_id));
-- Writes only through the functions below.

-- ── the law ─────────────────────────────────────────────────────────────────
create or replace function public.bb_doc_checklist(p_bill_type text, p_order_type text)
returns table(kind text, label text, final_only boolean)
language sql stable
as $$
  with t as (select coalesce(p_bill_type, 'Running') as bt, coalesce(p_order_type, 'WO') as ot)
  select kind, label, final_only from (
    select 'bill'::text as kind, 'Stamped bill / invoice'::text as label, false as final_only, 1 as ord
    union all select 'mb',           'Certified RA measurement sheet (cumulative)', false, 2
      from t where t.ot = 'WO' and t.bt in ('Running', 'Full & Final')
    union all select 'marking_plan', 'Marking plan / as-built drawing',            false, 3
      from t where t.ot = 'WO' and t.bt in ('Running', 'Full & Final')
    union all select 'no_due',       'No-Due certificate',                          true,  4
      from t where t.ot = 'WO' and t.bt = 'Full & Final' and public.bb_rule_on('bb_rule_final_no_due')
    union all select 'vcc',          'Virtual Completion Certificate',              true,  5
      from t where t.ot = 'WO' and t.bt = 'Full & Final'
    union all select 'warranty',     'Warranty / guarantee certificate or bond',    true,  6
      from t where t.ot = 'WO' and t.bt = 'Full & Final'
  ) x order by ord;
$$;
grant execute on function public.bb_doc_checklist(text, text) to authenticated;

-- One bill's checklist with its state: attached, waived (with the reason), or
-- missing. What the bill page and the phone summary draw.
create or replace function public.bb_doc_status(p_bill uuid)
returns table(kind text, label text, final_only boolean, state text,
              doc_name text, doc_by text, doc_at timestamptz,
              reason text, waived_by text, waived_at timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  select c.kind, c.label, c.final_only,
         case when d.id is not null then 'attached' when w.id is not null then 'waived' else 'missing' end,
         d.name, pd.full_name, d.created_at,
         w.reason, pw.full_name, w.created_at
  from public.bb_bills b
  cross join lateral public.bb_doc_checklist(b.bill_type, b.order_type) c
  left join lateral (select id, name, uploaded_by, created_at from public.bb_bill_docs x
                     where x.bill_id = b.id and (x.kind = c.kind or (c.kind = 'bill' and x.kind = 'stamped_bill'))
                     order by created_at desc limit 1) d on true
  left join public.profiles pd on pd.id = d.uploaded_by
  left join public.bb_bill_doc_waivers w on w.bill_id = b.id and w.kind = c.kind
  left join public.profiles pw on pw.id = w.created_by
  where b.id = p_bill;
$$;
grant execute on function public.bb_doc_status(uuid) to authenticated;

-- What is still missing — neither attached nor explained. Empty = the gate opens.
create or replace function public.bb_docs_missing(p_bill uuid)
returns table(kind text, label text)
language sql stable security definer set search_path to 'public'
as $$
  select kind, label from public.bb_doc_status(p_bill) where state = 'missing';
$$;

-- The register's tag, for many bills at once. One call, not one per row.
create or replace function public.bb_docs_missing_for(p_ids uuid[])
returns table(bill_id uuid, missing integer, labels text)
language sql stable security definer set search_path to 'public'
as $$
  select b.id, count(m.kind)::integer, string_agg(m.label, ', ' order by m.label)
  from unnest(p_ids) as i(id)
  join public.bb_bills b on b.id = i.id
  cross join lateral public.bb_docs_missing(b.id) m
  group by b.id;
$$;
grant execute on function public.bb_docs_missing_for(uuid[]) to authenticated;

-- ── the Site Head's reason ─────────────────────────────────────────────────
-- Only the bill's own Site Head (or the site_head desk, or an admin) may say a
-- document is not available; only on a bill that is at the Site Head; and the
-- reason has to say something.
create or replace function public.bb_rpc_waive_doc(p_bill uuid, p_kind text, p_reason text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_actor uuid := auth.uid(); v_stage public.bb_stage; v_project uuid; v_disc text; v_sub integer;
        v_admin boolean; v_member boolean; v_label text;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select current_stage, project_id, discipline, in4_subproject_id into v_stage, v_project, v_disc, v_sub
    from public.bb_bills where id = p_bill;
  if v_stage is null then raise exception 'Bill not found'; end if;
  if v_stage <> 'site_head' then
    raise exception 'A reason for a missing document is given at the Site Head step — this bill is at %', v_stage;
  end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin) into v_admin;
  select exists (select 1 from public.bb_stage_members(v_stage, v_project, v_disc, v_sub, p_bill) m where m = v_actor) into v_member;
  if not (v_member or v_admin) then
    raise exception 'Only the Site Head named on this bill can say a document is not available';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Say why the document is not available — eight characters is the least that says anything';
  end if;
  select c.label into v_label from public.bb_doc_checklist(
    (select bill_type from public.bb_bills where id = p_bill),
    (select order_type from public.bb_bills where id = p_bill)) c where c.kind = p_kind;
  if v_label is null then raise exception 'That document is not on this bill''s checklist'; end if;
  if exists (select 1 from public.bb_bill_docs where bill_id = p_bill
             and (kind = p_kind or (p_kind = 'bill' and kind = 'stamped_bill'))) then
    raise exception '% is already attached — no reason needed', v_label;
  end if;

  insert into public.bb_bill_doc_waivers(bill_id, kind, reason, created_by)
  values (p_bill, p_kind, btrim(p_reason), v_actor)
  on conflict (bill_id, kind) do update set reason = excluded.reason, created_by = excluded.created_by, created_at = now();

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (p_bill, v_stage, v_stage, 'doc_waived', v_label || ' not attached — ' || btrim(p_reason), null, v_actor);
  return jsonb_build_object('status', 'ok', 'kind', p_kind, 'label', v_label);
end $$;
grant execute on function public.bb_rpc_waive_doc(uuid, text, text) to authenticated;

-- Changed his mind, or found the paper: the reason goes, and the document is
-- expected again.
create or replace function public.bb_rpc_unwaive_doc(p_bill uuid, p_kind text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_actor uuid := auth.uid(); v_stage public.bb_stage; v_project uuid; v_disc text; v_sub integer;
        v_admin boolean; v_member boolean; v_label text;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select current_stage, project_id, discipline, in4_subproject_id into v_stage, v_project, v_disc, v_sub
    from public.bb_bills where id = p_bill;
  if v_stage is null then raise exception 'Bill not found'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin) into v_admin;
  select exists (select 1 from public.bb_stage_members(v_stage, v_project, v_disc, v_sub, p_bill) m where m = v_actor) into v_member;
  if not (v_member or v_admin) then raise exception 'Only the desk holding this bill can change that'; end if;
  select reason into v_label from public.bb_bill_doc_waivers where bill_id = p_bill and kind = p_kind;
  delete from public.bb_bill_doc_waivers where bill_id = p_bill and kind = p_kind;
  if found then
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (p_bill, v_stage, v_stage, 'doc_unwaived', 'Reason withdrawn — the document is expected again', null, v_actor);
  end if;
  return jsonb_build_object('status', 'ok');
end $$;
grant execute on function public.bb_rpc_unwaive_doc(uuid, text) to authenticated;

-- ── the gate, and who is told ──────────────────────────────────────────────
-- Inside bb_rpc_move, the Site Head's Forward now also needs every document on
-- the checklist attached or explained; the Disc Head's old "stamped bill" and
-- "No-Due" checks become the same single check (so a bill that skipped the
-- Site Head — Advance, Petty Cash, Misc — still needs its stamped bill there).
-- When a bill leaves the Site Head with reasons on it, the CT Disc Head, the
-- Project Head and the Atm Head are told what is missing and why.
create or replace function public.bb_tell_waivers(p_bill uuid, p_actor uuid) returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare v_project uuid; v_disc text; v_sub integer; v_vendor text; v_billno text; v_orderno text;
        v_body text; v_title text; v_uid uuid; v_told int := 0; v_n int; v_actor_name text;
begin
  select count(*) into v_n from public.bb_bill_doc_waivers where bill_id = p_bill;
  if v_n = 0 then return 0; end if;
  select project_id, discipline, in4_subproject_id, vendor_text, bill_no, order_no
    into v_project, v_disc, v_sub, v_vendor, v_billno, v_orderno from public.bb_bills where id = p_bill;
  select coalesce(full_name, email) into v_actor_name from public.profiles where id = p_actor;
  select string_agg('• ' || c.label || ' — ' || w.reason, E'\n' order by c.label)
    into v_body
    from public.bb_bill_doc_waivers w
    join public.bb_bills b on b.id = w.bill_id
    cross join lateral public.bb_doc_checklist(b.bill_type, b.order_type) c
    where w.bill_id = p_bill and c.kind = w.kind;
  v_title := coalesce(nullif(btrim(v_vendor), ''), 'A bill') || ' — ' || v_n
             || case when v_n = 1 then ' document' else ' documents' end || ' not attached, with reason';
  v_body := coalesce(nullif(btrim(v_orderno), ''), 'no order')
            || case when coalesce(btrim(v_billno), '') <> '' then ' · bill ' || btrim(v_billno) else '' end
            || ' · forwarded by ' || coalesce(v_actor_name, 'the Site Head') || E'\n\n' || v_body;

  for v_uid in
    select m from public.bb_stage_members('disc_head', v_project, v_disc, v_sub, p_bill) m
    union select m from public.bb_stage_members('atm_approval', v_project, v_disc, v_sub, p_bill) m
    union select user_id from public.cc_project_approvers where project_id = v_project and role = 'project_head'
  loop
    continue when v_uid is null or v_uid = p_actor;
    begin
      perform public.notify_user(v_uid, 'bb_docs_waived', v_title, v_body,
        '/bills-booking/' || p_bill::text, 'bills-booking', 'bb_bills', p_bill,
        jsonb_build_object('waived', v_n));
      v_told := v_told + 1;
    exception when others then null;
    end;
  end loop;
  return v_told;
end $$;
