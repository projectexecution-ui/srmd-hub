-- ============================================================
-- Per-module role overrides.
-- profiles.role is the default. An entry in user_module_roles
-- overrides it for one specific module_slug.
-- ============================================================

create table if not exists public.user_module_roles (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  module_slug  text not null,
  role         public.user_role not null,
  granted_by   uuid references public.profiles(id) on delete set null,
  granted_at   timestamptz not null default now(),
  notes        text,
  primary key (user_id, module_slug)
);

create index if not exists user_module_roles_user_idx   on public.user_module_roles(user_id);
create index if not exists user_module_roles_module_idx on public.user_module_roles(module_slug);

alter table public.user_module_roles enable row level security;

drop policy if exists user_module_roles_read on public.user_module_roles;
create policy user_module_roles_read on public.user_module_roles
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p
               where p.id = auth.uid()
                 and (p.role = 'admin' or p.is_portal_owner = true))
  );

drop policy if exists user_module_roles_write on public.user_module_roles;
create policy user_module_roles_write on public.user_module_roles
  for all to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and (p.role = 'admin' or p.is_portal_owner = true)))
  with check (exists (select 1 from public.profiles p
                      where p.id = auth.uid()
                        and (p.role = 'admin' or p.is_portal_owner = true)));

-- "What role does this user have for this module?"
-- Override wins, falls back to profiles.role.
create or replace function public.effective_user_role(
  p_user_id     uuid,
  p_module_slug text
) returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.user_module_roles
       where user_id = p_user_id and module_slug = p_module_slug),
    (select role from public.profiles where id = p_user_id)
  )
$$;

-- Re-deploy can_approve to use effective role
create or replace function public.can_approve(
  p_module_slug text,
  p_doc_type    text,
  p_from_stage  text,
  p_to_stage    text,
  p_amount      numeric default null
) returns boolean
language sql stable security definer as $$
  with me as (
    select public.effective_user_role(auth.uid(), p_module_slug)::text as role
  )
  select case
    when (select role from me) = 'admin' then true
    when exists (
      select 1 from public.approval_rules ar, me
      where ar.is_active = true
        and ar.module_slug = p_module_slug
        and ar.doc_type    = p_doc_type
        and ar.from_stage  = p_from_stage
        and ar.to_stage    = p_to_stage
        and (me.role = ar.approver_role or me.role = ar.override_role)
        and (ar.amount_cap_max is null or p_amount is null or p_amount <= ar.amount_cap_max)
    ) then true
    else false
  end
$$;

-- Re-deploy my_permissions to use effective role per-module
create or replace function public.my_permissions()
returns table(module_slug text, can_view boolean, can_edit boolean, can_admin boolean)
language sql stable security definer
set search_path = public
as $$
  select rp.module_slug, rp.can_view, rp.can_edit, rp.can_admin
  from public.role_permissions rp
  where rp.role::text = public.effective_user_role(auth.uid(), rp.module_slug)::text
$$;
