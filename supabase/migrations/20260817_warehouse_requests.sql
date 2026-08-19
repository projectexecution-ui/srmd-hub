-- Warehouse V2 — material requests, with a configurable approval chain.
--
-- Aksha: an engineer who wants something from another store had no way to ask
-- for it. The module recorded what MOVED and never what was WANTED, so the ask
-- happened on WhatsApp and the app learnt about it only afterwards.
--
-- Deliberately NOT a rebuild of V1's request chain, which took ten requests in
-- ten years. That died of four hands on a routine handover, no notifications,
-- and no store routing. Here the ask goes straight to the keeper of the store
-- it names, and approval is a rule you switch on rather than a step baked in.

-- ---------------------------------------------------------------------------
-- The request
-- ---------------------------------------------------------------------------
create table if not exists wh_requests (
  id                uuid primary key default gen_random_uuid(),
  req_no            text not null unique,
  request_date      date not null default ((now() at time zone 'Asia/Kolkata')::date),

  -- Which store is being asked, and what for.
  from_location_id  uuid not null references wh_locations(id),
  project_id        uuid references projects(id) on delete set null,
  purpose           text not null,
  need_by           date,

  -- Where it should end up. Null = issued to the requester's site; a store id
  -- makes it a transfer request between two stores.
  to_location_id    uuid references wh_locations(id),

  requested_by      uuid references profiles(id),

  status            text not null default 'pending'
                      check (status in ('pending','approved','rejected','part_issued','issued','cancelled')),

  -- The approval rule is FROZEN onto the request when it is raised. If the
  -- admin later changes the dial, a request already in flight keeps the rule it
  -- was judged under — otherwise a pending request silently changes its own
  -- requirements, which is the sort of thing nobody can audit afterwards.
  rule_at_raise     text not null default 'off',
  est_value         numeric,
  stages_needed     smallint not null default 0 check (stages_needed between 0 and 2),
  stages_done       smallint not null default 0 check (stages_done between 0 and 2),

  approved1_by      uuid references profiles(id),
  approved1_at      timestamptz,
  approved2_by      uuid references profiles(id),
  approved2_at      timestamptz,

  rejected_by       uuid references profiles(id),
  rejected_at       timestamptz,
  reject_reason     text,

  cancelled_by      uuid references profiles(id),
  cancelled_at      timestamptz,

  remarks           text,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid references profiles(id),

  -- A rejection without a reason is the thing the requester cannot act on.
  constraint wh_req_reject_reason
    check (status <> 'rejected' or coalesce(btrim(reject_reason), '') <> ''),
  -- A request cannot be more approved than it needs to be.
  constraint wh_req_stages_sane check (stages_done <= stages_needed)
);

create index if not exists wh_req_store_idx on wh_requests (from_location_id, status);
create index if not exists wh_req_mine_idx  on wh_requests (requested_by, request_date desc);
create index if not exists wh_req_open_idx  on wh_requests (status, request_date)
  where deleted_at is null and status in ('pending','approved','part_issued');

-- ---------------------------------------------------------------------------
-- What was asked for
-- ---------------------------------------------------------------------------
create table if not exists wh_request_lines (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references wh_requests(id) on delete cascade,
  item_id      uuid not null references wh_items(id),
  qty          numeric not null check (qty > 0),
  -- Filled in as the keeper issues against it. A part issue is normal.
  issued_qty   numeric not null default 0 check (issued_qty >= 0),
  note         text,
  unique (request_id, item_id)
);

create index if not exists wh_req_lines_idx on wh_request_lines (request_id);

-- ---------------------------------------------------------------------------
-- The issue that answers a request
-- ---------------------------------------------------------------------------
alter table wh_gate_out add column if not exists request_id uuid references wh_requests(id);
create index if not exists wh_gout_req_idx on wh_gate_out (request_id) where request_id is not null;

-- ---------------------------------------------------------------------------
-- Numbering: 'Rq: 17Aug26/001', same series machinery as the gate registers.
-- ---------------------------------------------------------------------------
create or replace function public.fn_wh_next_no(p_register text, p_day date default null::date)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
        n int;
        prefix text := case p_register when 'in' then 'In' when 'out' then 'Out'
                                       when 'move' then 'Tr' when 'req' then 'Rq'
                                       else 'Ct' end;
begin
  insert into wh_number_series (register, day, last_no) values (p_register, d, 1)
  on conflict (register, day) do update set last_no = wh_number_series.last_no + 1
  returning last_no into n;
  return prefix || ': ' || to_char(d, 'DDMonYY') || '/' || lpad(n::text, 3, '0');
end $function$;

-- ---------------------------------------------------------------------------
-- RLS — the same shape as every other wh_ table.
-- ---------------------------------------------------------------------------
alter table wh_requests      enable row level security;
alter table wh_request_lines enable row level security;

drop policy if exists wh_requests_read   on wh_requests;
drop policy if exists wh_requests_write  on wh_requests;
drop policy if exists wh_requests_delete on wh_requests;
create policy wh_requests_read   on wh_requests for select using (fn_wh_can('view'));
create policy wh_requests_write  on wh_requests for all    using (fn_wh_can('edit')) with check (fn_wh_can('edit'));
create policy wh_requests_delete on wh_requests for delete using (fn_wh_can('admin'));

drop policy if exists wh_request_lines_read   on wh_request_lines;
drop policy if exists wh_request_lines_write  on wh_request_lines;
drop policy if exists wh_request_lines_delete on wh_request_lines;
create policy wh_request_lines_read   on wh_request_lines for select using (fn_wh_can('view'));
create policy wh_request_lines_write  on wh_request_lines for all    using (fn_wh_can('edit')) with check (fn_wh_can('edit'));
create policy wh_request_lines_delete on wh_request_lines for delete using (fn_wh_can('admin'));
