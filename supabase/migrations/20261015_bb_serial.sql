-- Bills Approval: the hub number (Aksha, 15 Oct 2026 — "Yes this looks good").
--
-- Every real bill gets a number at entry: <project code>-<running number>,
-- e.g. WCE-9, NGHA-7, RUCFBE-10. The code is the CT Hub project the bill is
-- booked on — already sub-project level (NGH A, VINAY, RUCFBE) — with spaces
-- dropped; never IN4's own sub-project code (ND, SB01, VST01), which nobody
-- would read. The count is ONE line across the whole hub, never reset and
-- never reused, so "9" alone finds WCE-9. Examples get none. Given once: an
-- update cannot change it, a deleted bill's number is not handed out again.

alter table public.bb_bills
  add column if not exists serial text,
  add column if not exists serial_seq integer;
create unique index if not exists bb_bills_serial_uidx on public.bb_bills (serial) where serial is not null;
create unique index if not exists bb_bills_serial_seq_uidx on public.bb_bills (serial_seq) where serial_seq is not null;

-- One row, one count. Bumped under its row lock inside the insert, so two
-- bills entered at the same second cannot share a number, and a failed
-- insert rolls the count back — no gaps.
create table if not exists public.bb_serial_counter (
  one boolean primary key default true check (one),
  last_seq integer not null default 0
);
insert into public.bb_serial_counter (one, last_seq) values (true, 0) on conflict do nothing;
alter table public.bb_serial_counter enable row level security;
revoke all on public.bb_serial_counter from anon, authenticated;

-- The code in the number: the hub project's code, upper-case, spaces dropped
-- ("NGH A" → NGHA, "P2 A01" → P2A01). No project: CT.
create or replace function public.bb_serial_code(p_project uuid) returns text
language sql stable set search_path = public as $$
  select coalesce(nullif(upper(regexp_replace(p.code, '\s+', '', 'g')), ''), 'CT')
  from public.projects p where p.id = p_project
$$;

create or replace function public.bb_assign_serial() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_seq integer;
begin
  if tg_op = 'UPDATE' then
    -- Given once. Whatever an update says, the number stays.
    if old.serial is not null then
      new.serial := old.serial;
      new.serial_seq := old.serial_seq;
    end if;
    return new;
  end if;
  if coalesce(new.is_example, false) or new.serial is not null then return new; end if;
  update public.bb_serial_counter set last_seq = last_seq + 1 where one returning last_seq into v_seq;
  new.serial_seq := v_seq;
  new.serial := coalesce(public.bb_serial_code(new.project_id), 'CT') || '-' || v_seq;
  return new;
end $$;

drop trigger if exists bb_bills_serial on public.bb_bills;
create trigger bb_bills_serial before insert or update on public.bb_bills
  for each row execute function public.bb_assign_serial();

-- The real bills already on the register, oldest first.
with numbered as (
  select id, row_number() over (order by created_at, id) + (select last_seq from public.bb_serial_counter) as n
  from public.bb_bills where serial is null and not coalesce(is_example, false)
)
update public.bb_bills b
   set serial = coalesce(public.bb_serial_code(b.project_id), 'CT') || '-' || n.n, serial_seq = n.n
  from numbered n where n.id = b.id;
update public.bb_serial_counter
   set last_seq = greatest(last_seq, coalesce((select max(serial_seq) from public.bb_bills), 0));

-- ── The number leads every notice, so a reply can quote it ─────────────────

create or replace function public.bb_tell(p_bill uuid, p_stage bb_stage, p_type text, p_title text, p_body text, p_skip uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid; v_told integer := 0; v_project uuid; v_disc text; v_sub integer; v_serial text; v_title text;
begin
  select project_id, discipline, in4_subproject_id, serial
    into v_project, v_disc, v_sub, v_serial from public.bb_bills where id = p_bill;
  v_title := case when v_serial is not null and position(v_serial in coalesce(p_title, '')) = 0
                  then v_serial || ' · ' || p_title else p_title end;
  for v_uid in select m from public.bb_stage_members(p_stage, v_project, v_disc, v_sub, p_bill) m loop
    continue when v_uid is null or v_uid = p_skip;
    begin
      perform public.notify_user(v_uid, p_type, v_title, p_body, '/bills-booking/' || p_bill::text,
                                 'bills-booking', 'bb_bills', p_bill, jsonb_build_object('stage', p_stage::text));
      v_told := v_told + 1;
    exception when others then null;
    end;
  end loop;
  return v_told;
end $function$;

create or replace function public.bb_tell_waivers(p_bill uuid, p_actor uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_project uuid; v_disc text; v_sub integer; v_vendor text; v_billno text; v_orderno text; v_serial text;
        v_body text; v_title text; v_uid uuid; v_told int := 0; v_n int; v_actor_name text;
begin
  select count(*) into v_n from public.bb_bill_doc_waivers where bill_id = p_bill;
  if v_n = 0 then return 0; end if;
  select project_id, discipline, in4_subproject_id, vendor_text, bill_no, order_no, serial
    into v_project, v_disc, v_sub, v_vendor, v_billno, v_orderno, v_serial from public.bb_bills where id = p_bill;
  select coalesce(full_name, email) into v_actor_name from public.profiles where id = p_actor;
  select string_agg('• ' || c.label || ' — ' || w.reason, E'\n' order by c.label)
    into v_body
    from public.bb_bill_doc_waivers w
    join public.bb_bills b on b.id = w.bill_id
    cross join lateral public.bb_doc_checklist(b.bill_type, b.order_type) c
    where w.bill_id = p_bill and c.kind = w.kind;
  v_title := coalesce(v_serial || ' · ', '') || coalesce(nullif(btrim(v_vendor), ''), 'A bill') || ' — ' || v_n
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
end $function$;

-- Entry: the Site Head's own notice carries the number, and the caller gets it
-- back to say "Entered as WCE-9". Otherwise unchanged from 14 Oct 2026.
create or replace function public.bb_rpc_create_bill(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_actor uuid := auth.uid(); v_edit boolean; v_id uuid; v_owner uuid; v_owner_name text; v_serial text;
  v_wo numeric; v_paid numeric; v_claim numeric; v_otype text; v_pending boolean; v_amend boolean; v_stage bb_stage;
  v_type text := nullif(p->>'bill_type', '');
  v_skip boolean;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select exists (select 1 from public.role_permissions rp, public.profiles pr
    where pr.id=v_actor and rp.role=pr.role and rp.module_slug='bills-booking' and (rp.can_edit=true or rp.can_admin=true))
      or exists (select 1 from public.bb_desk_members m where m.user_id = v_actor and m.desk = 'erp')
    into v_edit;
  if not v_edit then raise exception 'You do not have permission to enter bills — ask an admin to seat you on the ERP entry desk'; end if;

  v_otype := coalesce(nullif(p->>'order_type',''),'WO');
  v_wo    := (p->>'wo_value')::numeric;
  v_paid  := coalesce((p->>'paid_till_date')::numeric, 0);
  v_claim := coalesce((p->>'claimed_amount')::numeric, 0);
  v_pending := (v_otype = 'Without WO/PO');
  v_amend := (not v_pending) and v_wo is not null and v_wo > 0 and (v_paid + v_claim) > v_wo;
  -- These four have no measurement in IN4, so no Site Head (Aksha, 14 Oct 2026).
  v_skip := public.bb_rule_on('bb_rule_skip_site_head')
            and coalesce(v_type, '') in ('Advance', 'Petty Cash', 'Misc', 'Retention release');
  v_owner := case when v_skip then null else nullif(p->>'owner_id','')::uuid end;
  if v_owner is not null then
    select coalesce(full_name, email) into v_owner_name from public.profiles where id = v_owner;
    if v_owner_name is null then raise exception 'That Site Head is not a CT Hub user'; end if;
  end if;
  v_stage := case when v_skip then 'disc_head'::bb_stage
                  when v_owner is not null then 'site_head'::bb_stage else 'submitted'::bb_stage end;

  insert into public.bb_bills(order_type, bill_type, order_no, project_id, vendor_id, vendor_text, discipline,
    discipline_id, work, bill_no, ra_no, bill_date, claimed_amount, trust, wo_value, paid_till_date, bill_category,
    ct_other_dept, abstract_no_in4, in4_subproject_id, wo_pending, amendment_flag, created_by, owner_id, current_stage, stage_since)
  values (
    v_otype, v_type, nullif(p->>'order_no',''),
    nullif(p->>'project_id','')::uuid, nullif(p->>'vendor_id','')::uuid, nullif(p->>'vendor_text',''),
    nullif(p->>'discipline',''), nullif(p->>'discipline_id','')::uuid, nullif(p->>'work',''),
    nullif(p->>'bill_no',''), nullif(p->>'ra_no',''),
    nullif(p->>'bill_date','')::date, v_claim, nullif(p->>'trust',''),
    v_wo, v_paid, nullif(p->>'bill_category',''), nullif(p->>'ct_other_dept',''),
    nullif(p->>'abstract_no_in4',''), nullif(p->>'in4_subproject_id','')::integer,
    v_pending, v_amend, v_actor, v_owner, v_stage, now())
  returning id, serial into v_id, v_serial;

  insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
  values (v_id, null, 'submitted', 'forward', nullif(p->>'comment',''), v_claim, v_actor);

  if v_skip then
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (v_id, 'submitted', 'disc_head', 'forward',
            v_type || ' — no Site Head step; straight to the CT Disc Head', v_claim, v_actor);
    perform public.bb_tell(v_id, 'disc_head', 'bb_bill_arrived',
      coalesce(nullif(p->>'vendor_text',''), 'A bill') || ' — ' || coalesce(nullif(p->>'bill_no',''), 'bill') || ' is on your desk',
      coalesce(nullif(p->>'order_no',''), 'no order') || ' · ' || public.fn_inr(v_claim)
        || E'\n' || v_type || ' — there is no Site Head step for this type. Check it and send it to the CT Head.',
      v_actor);
  elsif v_owner is not null then
    insert into public.bb_bill_events(bill_id, from_stage, to_stage, action, comment, amount_snapshot, actor_id)
    values (v_id, 'submitted', 'site_head', 'forward', 'Assigned to ' || v_owner_name || ' as Site Head', v_claim, v_actor);
    if v_owner <> v_actor then
      begin
        perform public.notify_user(v_owner, 'bb_bill_assigned',
          coalesce(v_serial || ' · ', '') || coalesce(nullif(p->>'vendor_text',''), 'A bill') || ' — a bill is with you to process',
          'Bill ' || coalesce(nullif(p->>'bill_no',''), '—') || ' on ' || coalesce(nullif(p->>'order_no',''), 'no order')
            || ' · ' || public.fn_inr(v_claim) || E'\nMake the abstract / goods receipt in IN4, then pick it here and send it to the CT Disc Head.',
          '/bills-booking/' || v_id::text, 'bills-booking', 'bb_bills', v_id, jsonb_build_object('stage', 'site_head'));
      exception when others then null;
      end;
    end if;
  end if;

  return jsonb_build_object('status','ok','bill_id', v_id, 'serial', v_serial, 'amendment_needed', v_amend, 'wo_pending', v_pending, 'stage', v_stage::text);
end $function$;
