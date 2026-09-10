-- Name layer, Phase 3 (Aksha, 10 Sep 2026): CT Hub display names for things
-- IN4 (or the code) names — with a SCOPE, so one rename can apply to the whole
-- app, to one module, or to one project. "Finishes" can read "Interiors" on
-- NGH B alone while every other project keeps "Finishes".
--
-- Identity stays IN4's: rows are keyed by IN4's stable id (a skill id) or the
-- workspace registry slug (ws:budget, ws:budget:by-order), never by the text.
-- Nothing that matches money reads this table. Additive; idempotent.
--
-- Who may name: an admin, the Portal Owner, or anyone listed in the
-- app_settings key `cthub_namers` — the same grant pattern as cc_archive_users.
-- Parimal (parimal.srmd@gmail.com) is seeded, per Aksha.

create table if not exists public.cthub_names (
  kind         text not null check (kind in ('skill', 'tab', 'pill')),
  key          text not null,                       -- skill:<in4 id> · ws:<tab> · ws:<tab>:<pill>
  scope        text not null default 'all' check (scope in ('all', 'module', 'project')),
  scope_id     text not null default '',            -- module slug or project uuid; '' for 'all'
  display_name text not null,
  note         text,
  set_by       uuid,
  set_at       timestamptz not null default now(),
  primary key (kind, key, scope, scope_id)
);
comment on table public.cthub_names is
  'CT Hub display names over IN4 identities, scoped all / module / project. Display only — never a match key.';

alter table public.cthub_names enable row level security;
drop policy if exists cthub_names_read on public.cthub_names;
create policy cthub_names_read on public.cthub_names
  for select to authenticated using ((select auth.uid()) is not null);
-- Writes go through set_cthub_name() only (no insert/update/delete policy).

insert into public.app_settings (key, value)
values ('cthub_namers', '24ca9694-982f-40bb-8ef4-48dc2604fe83')
on conflict (key) do nothing;

create or replace function public.set_cthub_name(
  p_kind text, p_key text, p_scope text, p_scope_id text, p_display text, p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granted boolean;
begin
  v_granted :=
       (public.effective_user_role(auth.uid(), 'cost-control')::text = 'admin')
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_portal_owner)
    or position(auth.uid()::text in coalesce(
         (select value from public.app_settings where key = 'cthub_namers'), '')) > 0;
  if not v_granted then
    raise exception 'You are not allowed to rename things in CT Hub — ask an Admin';
  end if;
  if p_kind not in ('skill', 'tab', 'pill') then raise exception 'Unknown kind %', p_kind; end if;
  if p_scope not in ('all', 'module', 'project') then raise exception 'Unknown scope %', p_scope; end if;
  if p_scope = 'all' and coalesce(p_scope_id, '') <> '' then raise exception 'Everywhere takes no scope id'; end if;
  if p_scope <> 'all' and coalesce(p_scope_id, '') = '' then raise exception 'Scope % needs an id', p_scope; end if;

  if p_display is null or btrim(p_display) = '' then
    -- Clearing = back to IN4's (or the registry's) own text at this scope.
    delete from public.cthub_names
     where kind = p_kind and key = p_key and scope = p_scope and scope_id = coalesce(p_scope_id, '');
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;

  insert into public.cthub_names (kind, key, scope, scope_id, display_name, note, set_by, set_at)
  values (p_kind, p_key, p_scope, coalesce(p_scope_id, ''), btrim(p_display), nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (kind, key, scope, scope_id) do update
    set display_name = excluded.display_name, note = excluded.note, set_by = excluded.set_by, set_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.set_cthub_name(text, text, text, text, text, text) to authenticated;
