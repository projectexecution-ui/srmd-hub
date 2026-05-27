-- ============================================================
-- Per-user module blocks. A row hides the module from that one user,
-- regardless of what their role would otherwise allow. Layers ON TOP of
-- the role/module-role permission system — there's no "force-allow"
-- variant on purpose; if someone needs access, give their role/override
-- the right permission.
-- ============================================================

create table if not exists public.user_module_blocks (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  module_slug  text not null,
  blocked_by   uuid references public.profiles(id) on delete set null,
  blocked_at   timestamptz not null default now(),
  reason       text,
  primary key (user_id, module_slug)
);

create index if not exists user_module_blocks_user_idx   on public.user_module_blocks(user_id);
create index if not exists user_module_blocks_module_idx on public.user_module_blocks(module_slug);

alter table public.user_module_blocks enable row level security;

drop policy if exists user_module_blocks_read on public.user_module_blocks;
create policy user_module_blocks_read on public.user_module_blocks
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p
               where p.id = auth.uid()
                 and (p.role = 'admin' or p.is_portal_owner = true))
  );

drop policy if exists user_module_blocks_write on public.user_module_blocks;
create policy user_module_blocks_write on public.user_module_blocks
  for all to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and (p.role = 'admin' or p.is_portal_owner = true)))
  with check (exists (select 1 from public.profiles p
                      where p.id = auth.uid()
                        and (p.role = 'admin' or p.is_portal_owner = true)));

-- Update my_permissions to exclude any module the caller has been
-- personally blocked from.
create or replace function public.my_permissions()
returns table(module_slug text, can_view boolean, can_edit boolean, can_admin boolean)
language sql stable security definer
set search_path = public
as $$
  select rp.module_slug, rp.can_view, rp.can_edit, rp.can_admin
  from public.role_permissions rp
  where rp.role::text = public.effective_user_role(auth.uid(), rp.module_slug)::text
    and not exists (
      select 1 from public.user_module_blocks b
      where b.user_id = auth.uid()
        and b.module_slug = rp.module_slug
    )
$$;
