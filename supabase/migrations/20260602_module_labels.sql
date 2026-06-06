-- Per-module display label overrides. Portal Owner / admin can rename any
-- module without touching code; the defaults remain in lib/modules.ts.

create table if not exists public.module_labels (
  slug         text primary key,
  label        text not null,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);

comment on table public.module_labels is
  'Portal Owner-editable display labels for module slugs. Empty = use MODULES defaults from lib/modules.ts.';

create or replace function public.module_labels_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_module_labels_touch on public.module_labels;
create trigger trg_module_labels_touch
  before insert or update on public.module_labels
  for each row execute function public.module_labels_touch();

alter table public.module_labels enable row level security;

drop policy if exists module_labels_read on public.module_labels;
create policy module_labels_read on public.module_labels for select to authenticated using (true);

drop policy if exists module_labels_write on public.module_labels;
create policy module_labels_write on public.module_labels for all to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.is_portal_owner = true or p.role = 'admin'))
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and (p.is_portal_owner = true or p.role = 'admin'))
  );

create or replace function public.set_module_label(p_slug text, p_label text, p_description text)
returns void language plpgsql security definer as $$
begin
  if not exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and (p.is_portal_owner = true or p.role = 'admin')) then
    raise exception 'Only admin or Portal Owner can rename modules';
  end if;
  insert into public.module_labels(slug, label, description)
  values (p_slug, p_label, nullif(p_description, ''))
  on conflict (slug) do update set
    label = excluded.label,
    description = excluded.description;
end $$;
