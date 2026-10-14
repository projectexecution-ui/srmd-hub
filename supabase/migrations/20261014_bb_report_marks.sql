-- Bills Approval: the Daily Bills Report (Aksha, 14 Oct 2026 — "the Billing
-- team can make the report and share to management on daily basis"; source:
-- Bills Approval only; who edits: CT Billing + admins).
--
-- The report itself is computed from bb_bills and its stage history. The only
-- thing typed is, per bill: the courier date (SRET) or submission date (other
-- trusts), a remark, and the trust when the bill's order does not say.
-- Everyone who can see the bill sees these; only the CT Billing desk for that
-- bill, or a Bills admin, writes them — through the function, never directly.
--
-- UNDO: drop function if exists public.bb_rpc_set_report_mark(uuid, date, text, text);
--       drop table if exists public.bb_report_marks;

create table if not exists public.bb_report_marks (
  bill_id    uuid primary key references public.bb_bills(id) on delete cascade,
  sent_date  date,
  remark     text check (remark is null or char_length(remark) <= 200),
  trust      text check (trust is null or trust in ('SRET', 'SRAH', 'SRASSK', 'SRA')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.bb_report_marks enable row level security;
drop policy if exists bb_report_marks_read on public.bb_report_marks;
create policy bb_report_marks_read on public.bb_report_marks
  for select to authenticated using (public.bb_can_see((select auth.uid())));
comment on table public.bb_report_marks is
  'What CT Billing types on the Daily Bills Report per bill: courier / submission date, remark, trust when the order does not say. Written only by bb_rpc_set_report_mark.';

create or replace function public.bb_rpc_set_report_mark(p_bill uuid, p_sent_date date, p_remark text, p_trust text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid(); b record; v_admin boolean; v_desk boolean;
  v_remark text := nullif(btrim(coalesce(p_remark, '')), '');
  v_trust text := nullif(upper(btrim(coalesce(p_trust, ''))), '');
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select id, project_id, in4_subproject_id into b from public.bb_bills where id = p_bill;
  if b.id is null then raise exception 'That bill does not exist'; end if;

  select exists (select 1 from public.role_permissions rp, public.profiles pr
                  where pr.id = v_actor and rp.role = pr.role and rp.module_slug = 'bills-booking' and rp.can_admin = true) into v_admin;
  select v_actor in (select m from public.bb_desk_members_for('ct_billing', b.project_id, b.in4_subproject_id) m) into v_desk;
  if not (coalesce(v_admin, false) or coalesce(v_desk, false)) then
    raise exception 'Only CT Billing or a Bills admin can fill the daily report';
  end if;
  if v_remark is not null and char_length(v_remark) > 200 then raise exception 'Keep the remark under 200 characters'; end if;
  if v_trust is not null and v_trust not in ('SRET', 'SRAH', 'SRASSK', 'SRA') then
    raise exception 'Trust must be SRET, SRAH, SRASSK or SRA';
  end if;
  if p_sent_date is not null and p_sent_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'The date cannot be in the future';
  end if;

  insert into public.bb_report_marks(bill_id, sent_date, remark, trust, updated_by, updated_at)
  values (p_bill, p_sent_date, v_remark, v_trust, v_actor, now())
  on conflict (bill_id) do update
     set sent_date = excluded.sent_date, remark = excluded.remark, trust = excluded.trust,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  return jsonb_build_object('status', 'ok', 'sent_date', p_sent_date, 'remark', v_remark, 'trust', v_trust);
end $function$;

revoke execute on function public.bb_rpc_set_report_mark(uuid, date, text, text) from public, anon;
grant execute on function public.bb_rpc_set_report_mark(uuid, date, text, text) to authenticated;
