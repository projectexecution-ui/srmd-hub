-- ============================================================
-- Site stock check (custody tally): engineers periodically count what's
-- physically on their site vs. what the ledger says was sent (issued − returned).
-- Consumables: "used to date = sent − left". Returnables: shortfall = missing.
-- Applied live 2026-08-07.
-- ============================================================
create extension if not exists "uuid-ossp";

create table if not exists public.inv_stock_checks (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.projects(id),
  week_start   date not null,                       -- IST Monday of the week counted
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  requested_by uuid references public.profiles(id) on delete set null,  -- set if management asked
  requested_at timestamptz
);
create index if not exists inv_stock_checks_project_idx on public.inv_stock_checks(project_id, week_start desc);

create table if not exists public.inv_stock_check_items (
  id            uuid primary key default uuid_generate_v4(),
  check_id      uuid not null references public.inv_stock_checks(id) on delete cascade,
  item_id       uuid not null references public.inv_items(id),
  is_returnable boolean not null default false,     -- durable (must-match) vs consumable
  expected_qty  numeric not null default 0,         -- net sent to site (issued − returned) at submit
  actual_qty    numeric not null default 0,         -- counted physically on site
  remarks       text
);
create index if not exists inv_stock_check_items_check_idx on public.inv_stock_check_items(check_id);
create index if not exists inv_stock_check_items_item_idx on public.inv_stock_check_items(item_id);

alter table public.inv_stock_checks enable row level security;
alter table public.inv_stock_check_items enable row level security;

create or replace function public.inv_custody_is_mgmt()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('admin','project_head','head','founder')
$$;

drop policy if exists inv_stock_checks_select on public.inv_stock_checks;
create policy inv_stock_checks_select on public.inv_stock_checks
  for select to authenticated using (
    exists (select 1 from public.role_permissions rp, public.profiles p
            where p.id = auth.uid() and rp.role = p.role
              and rp.module_slug = 'inventory' and rp.can_view = true)
    and (
      public.inv_custody_is_mgmt()
      or created_by = auth.uid()
      or exists (select 1 from public.inv_engineer_projects ep
                 where ep.engineer_id = auth.uid() and ep.project_id = inv_stock_checks.project_id)
    )
  );

drop policy if exists inv_stock_check_items_select on public.inv_stock_check_items;
create policy inv_stock_check_items_select on public.inv_stock_check_items
  for select to authenticated using (
    exists (select 1 from public.inv_stock_checks c where c.id = check_id)
  );

drop policy if exists inv_stock_checks_admin_del on public.inv_stock_checks;
create policy inv_stock_checks_admin_del on public.inv_stock_checks
  for delete to authenticated using (public.current_user_role() = 'admin');

insert into public.notification_rules (scope, scope_key, event_type, channel, enabled)
values ('global','','inv_site_stock_reminder','email',false),
       ('global','','inv_site_stock_reminder','in_app',false)
on conflict do nothing;

-- Submit a site stock check. Expected qty per item is computed SERVER-SIDE from
-- the issue/return ledger (engineer can't influence it). p_items = jsonb array of
-- {item_id, actual_qty, remarks}. p_week_start = IST Monday of the counted week.
create or replace function public.inv_rpc_submit_stock_check(
  p_project uuid, p_week_start date, p_items jsonb, p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_can_edit boolean;
  v_allowed boolean;
  v_check_id uuid;
  v_row jsonb; v_item uuid; v_actual numeric; v_remarks text;
  v_expected numeric; v_returnable boolean;
  v_lines int := 0; v_variances int := 0;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  if p_project is null then raise exception 'Project is required'; end if;
  if p_week_start is null then raise exception 'Week is required'; end if;

  select exists (select 1 from public.role_permissions rp, public.profiles p
    where p.id = v_actor and rp.role = p.role and rp.module_slug='inventory' and rp.can_edit = true)
    into v_can_edit;
  if not v_can_edit then raise exception 'You do not have permission to record a stock check'; end if;

  select (public.inv_custody_is_mgmt()
          or exists (select 1 from public.inv_engineer_projects ep
                     where ep.engineer_id = v_actor and ep.project_id = p_project))
    into v_allowed;
  if not v_allowed then raise exception 'You are not assigned to this site'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Nothing to record — no items counted';
  end if;

  insert into public.inv_stock_checks(project_id, week_start, note, created_by)
  values (p_project, p_week_start, nullif(btrim(coalesce(p_note,'')),''), v_actor)
  returning id into v_check_id;

  for v_row in select * from jsonb_array_elements(p_items) loop
    v_item   := (v_row->>'item_id')::uuid;
    v_actual := (v_row->>'actual_qty')::numeric;
    v_remarks:= nullif(btrim(coalesce(v_row->>'remarks','')),'');
    if v_item is null or v_actual is null or v_actual < 0 then continue; end if;

    select coalesce(sum(ri.issued_qty - ri.returned_good_qty - ri.returned_damaged_qty), 0),
           coalesce(bool_or(ri.is_returnable and (ri.issued_qty - ri.returned_good_qty - ri.returned_damaged_qty) > 0), false)
      into v_expected, v_returnable
    from public.inv_request_items ri
    join public.inv_requests r on r.id = ri.request_id
    where r.project_id = p_project and ri.item_id = v_item;

    insert into public.inv_stock_check_items(check_id, item_id, is_returnable, expected_qty, actual_qty, remarks)
    values (v_check_id, v_item, v_returnable, v_expected, v_actual, v_remarks);

    v_lines := v_lines + 1;
    if (v_returnable and v_actual < v_expected) or (v_actual > v_expected) then
      v_variances := v_variances + 1;
    end if;
  end loop;

  if v_lines = 0 then
    delete from public.inv_stock_checks where id = v_check_id;
    raise exception 'Nothing to record — no valid item counts';
  end if;

  return jsonb_build_object('status','ok','check_id', v_check_id, 'lines', v_lines, 'variances', v_variances);
end $$;

grant execute on function public.inv_rpc_submit_stock_check(uuid, date, jsonb, text) to authenticated;

-- ── Read RPCs (definer, so they aggregate the whole project ledger past RLS) ──
create or replace function public.inv_rpc_custody_prefill(p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_ok boolean; v_out jsonb;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  select (public.inv_custody_is_mgmt()
          or exists (select 1 from public.inv_engineer_projects ep
                     where ep.engineer_id = v_actor and ep.project_id = p_project)) into v_ok;
  if not v_ok then raise exception 'You are not assigned to this site'; end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.is_returnable desc, t.category nulls last, t.name), '[]'::jsonb)
  into v_out from (
    select it.id as item_id, it.code, it.name, it.category, it.unit,
      sum(ri.issued_qty - ri.returned_good_qty - ri.returned_damaged_qty) as expected,
      coalesce(bool_or(ri.is_returnable and (ri.issued_qty - ri.returned_good_qty - ri.returned_damaged_qty) > 0), false) as is_returnable,
      (select ci.actual_qty from public.inv_stock_check_items ci
         join public.inv_stock_checks c on c.id = ci.check_id
        where c.project_id = p_project and ci.item_id = it.id
        order by c.week_start desc, c.created_at desc limit 1) as last_actual
    from public.inv_request_items ri
    join public.inv_requests r on r.id = ri.request_id
    join public.inv_items it on it.id = ri.item_id
    where r.project_id = p_project and ri.issued_qty > 0
    group by it.id, it.code, it.name, it.category, it.unit
    having sum(ri.issued_qty - ri.returned_good_qty - ri.returned_damaged_qty) > 0
  ) t;
  return v_out;
end $$;
grant execute on function public.inv_rpc_custody_prefill(uuid) to authenticated;

create or replace function public.inv_rpc_custody_projects()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_mgmt boolean; v_out jsonb;
begin
  if v_actor is null then raise exception 'Not signed in'; end if;
  v_mgmt := public.inv_custody_is_mgmt();
  select coalesce(jsonb_agg(row_to_json(t) order by t.code), '[]'::jsonb) into v_out from (
    select p.id as project_id, p.code, p.name,
      bal.items_on_site,
      lc.week_start as last_week_start, lc.created_at as last_created_at,
      coalesce(lv.variances, 0) as last_variances
    from public.projects p
    join (
      select r.project_id, count(distinct ri.item_id) as items_on_site
      from public.inv_request_items ri join public.inv_requests r on r.id = ri.request_id
      where ri.issued_qty > 0
      group by r.project_id
      having sum(ri.issued_qty - ri.returned_good_qty - ri.returned_damaged_qty) > 0
    ) bal on bal.project_id = p.id
    left join lateral (
      select c.id, c.week_start, c.created_at from public.inv_stock_checks c
      where c.project_id = p.id order by c.week_start desc, c.created_at desc limit 1
    ) lc on true
    left join lateral (
      select count(*) as variances from public.inv_stock_check_items ci
      where ci.check_id = lc.id
        and ((ci.is_returnable and ci.actual_qty < ci.expected_qty) or (ci.actual_qty > ci.expected_qty))
    ) lv on true
    where p.archived_at is null
      and (v_mgmt or exists (select 1 from public.inv_engineer_projects ep
                             where ep.engineer_id = v_actor and ep.project_id = p.id))
  ) t;
  return v_out;
end $$;
grant execute on function public.inv_rpc_custody_projects() to authenticated;
