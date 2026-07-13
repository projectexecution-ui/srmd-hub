-- ============================================================================
-- CC reshape stage 2 — approval workflow v2
--   • per-stage checked amounts (Project Head / Atm Head type what they checked)
--   • IN4 entry tracking for the Billing team (no money written — Budget (ERP)
--     stays BPH-import-only, so no double entry)
--   • working-sheet comments (append-only, "comment where you can see")
--   • billing role visibility + seeds
--   • cc_set_project_area (projects UPDATE RLS is admin/uploader-only)
-- Rollback: supabase/rollback/20260714_cc_reshape_ROLLBACK.sql
-- ============================================================================

-- A. Per-stage checked amounts + IN4 tracking on working sheets.
--    No CHECK constraints on the amounts: the whole point is that each
--    approver types their own number; the server action validates > 0.
alter table public.cc_working_sheets
  add column if not exists ph_checked_amt  numeric,
  add column if not exists ph_checked_at   timestamptz,
  add column if not exists ph_checked_by   uuid references public.profiles(id) on delete set null,
  add column if not exists atm_checked_amt numeric,
  add column if not exists atm_checked_at  timestamptz,
  add column if not exists atm_checked_by  uuid references public.profiles(id) on delete set null,
  add column if not exists in4_entered_at  timestamptz,
  add column if not exists in4_entered_by  uuid references public.profiles(id) on delete set null,
  add column if not exists in4_ref         text;

-- B. SQL mirror of checkIsCcReviewer(): admin, or the caller's effective
--    cost-control role appears on an active approval rule for working sheets.
create or replace function public.fn_cc_is_reviewer(p_user uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.fn_cc_is_admin(p_user)
      or exists (
        select 1 from public.approval_rules ar
        where ar.is_active
          and ar.module_slug = 'cost-control'
          and ar.doc_type    = 'cc_working_sheet'
          and public.effective_user_role(p_user, 'cost-control')::text
              in (ar.approver_role, coalesce(ar.override_role, ''))
      );
$$;

-- C. Billing visibility: one extra OR-arm on fn_cc_user_in_project (the
--    cc_ws_read gate). Read-only — cc_ws_update and row-write policies are
--    untouched, so billing can see sheets but never edit them.
create or replace function public.fn_cc_user_in_project(p_user uuid, p_project uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from project_assignments
    where user_id = p_user and project_id = p_project
  )
  or fn_cc_is_admin(p_user)
  or exists (
    select 1 from role_permissions rp
    join profiles pro on pro.role::text = rp.role::text
    where pro.id = p_user
      and rp.module_slug = 'cost-control'
      and rp.can_admin = true
  )
  or public.effective_user_role(p_user, 'cost-control')::text = 'billing';
$$;

-- D. Comments — append-only; "you can comment on any sheet you can see".
--    The EXISTS on cc_working_sheets runs as the caller, so the sheet's own
--    RLS (cc_ws_read) is the visibility gate for both reading and writing.
create table if not exists public.cc_ws_comments (
  id         uuid primary key default gen_random_uuid(),
  ws_id      uuid not null references public.cc_working_sheets(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists cc_ws_comments_ws_idx on public.cc_ws_comments(ws_id, created_at);
alter table public.cc_ws_comments enable row level security;

drop policy if exists cc_ws_comments_read on public.cc_ws_comments;
create policy cc_ws_comments_read on public.cc_ws_comments
  for select to authenticated using (
    exists (select 1 from public.role_permissions rp, public.profiles p
            where p.id = auth.uid() and rp.role = p.role
              and rp.module_slug = 'cost-control' and rp.can_view = true)
    and exists (select 1 from public.cc_working_sheets ws
                where ws.id = cc_ws_comments.ws_id)
  );

drop policy if exists cc_ws_comments_insert on public.cc_ws_comments;
create policy cc_ws_comments_insert on public.cc_ws_comments
  for insert to authenticated with check (
    author_id = auth.uid()
    and exists (select 1 from public.role_permissions rp, public.profiles p
                where p.id = auth.uid() and rp.role = p.role
                  and rp.module_slug = 'cost-control' and rp.can_view = true)
    and exists (select 1 from public.cc_working_sheets ws
                where ws.id = cc_ws_comments.ws_id)
  );
-- no UPDATE/DELETE policies: comments are append-only

-- E. Billing marks a released sheet as entered in IN4. SECURITY DEFINER
--    because cc_ws_update RLS would block a direct UPDATE for billing.
--    No status change (the approval matrix trigger fires only on status),
--    and no money is written anywhere.
create or replace function public.cc_mark_in4_entered(p_ws_id uuid, p_ref text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_ws public.cc_working_sheets%rowtype;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- coalesce matters: a user without a profile row gets NULL from
  -- effective_user_role, and NULL = 'billing' would slip past a bare NOT.
  v_role := coalesce(public.effective_user_role(auth.uid(), 'cost-control')::text, '');
  if not (v_role = 'billing' or public.fn_cc_is_admin(auth.uid())) then
    raise exception 'Only the Billing team (or an admin) can mark IN4 entry';
  end if;

  select * into v_ws from public.cc_working_sheets where id = p_ws_id for update;
  if not found then
    raise exception 'Working Sheet not found';
  end if;
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
     set in4_entered_at = now(),
         in4_entered_by = auth.uid(),
         in4_ref        = nullif(btrim(coalesce(p_ref, '')), '')
   where id = p_ws_id;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.cc_mark_in4_entered(uuid, text) to authenticated;

-- F. Project area edit for CC management. projects UPDATE RLS is
--    is_writer() (admin/uploader only), so heads/founder need this RPC.
create or replace function public.cc_set_project_area(p_project_id uuid, p_sft numeric)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.fn_cc_is_reviewer(auth.uid()) then
    raise exception 'Only Cost Control management can set the project area';
  end if;
  if p_sft is not null and (p_sft < 0 or p_sft > 100000000) then
    raise exception 'Area must be a positive number of sft';
  end if;

  update public.projects set built_up_sft = p_sft where id = p_project_id;
  if not found then
    raise exception 'Project not found';
  end if;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.cc_set_project_area(uuid, numeric) to authenticated;

-- G. Billing role seeds: label + cost-control view-only permission.
insert into public.role_labels (role, label, description)
values ('billing', 'Billing (IN4 Entry)',
        'Enters approved Working Sheet amounts into the IN4 ERP. Sees the Cost Control billing queue; cannot edit or approve sheets.')
on conflict (role) do update
  set label = excluded.label,
      description = excluded.description,
      is_active = true;

insert into public.role_permissions (module_slug, role, can_view, can_edit, can_admin)
values ('cost-control', 'billing', true, false, false)
on conflict (role, module_slug) do nothing;

-- H. Hardening: definer functions must not be callable by anon/public
--    (both RPCs also guard on auth.uid(), this is belt-and-braces).
revoke execute on function public.cc_mark_in4_entered(uuid, text) from public, anon;
revoke execute on function public.cc_set_project_area(uuid, numeric) from public, anon;
revoke execute on function public.fn_cc_is_reviewer(uuid) from public, anon;
