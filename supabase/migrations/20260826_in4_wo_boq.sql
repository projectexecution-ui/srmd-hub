-- IN4 sync: WO BOQ item rows (ORDERED) + certified-per-bill (abstract) rows.
--
-- Two mirror tables the 'boq' feed fills from IN4, so a screen can show ordered
-- quantity/rate next to the quantity certified in each bill:
--   in4_wo_boq_items       BI.FACT_ENGG_WORK_ORDER_BOQ  (+ DIM for name/unit)
--   in4_wo_abstract_items  BI.FACT_ENGG_WO_ABSTRACT_BOQ + ENGG_BOQ_ABSTRACT header
-- Join the two on ITEM_ID (never BOQ_ID — the facts disagree by one).
--
-- Read = any signed-in user (same as the other in4_* mirrors); writes are
-- service-role only (the sync is the single writer). Idempotent for the
-- merge-time auto-apply Action.

create table if not exists public.in4_wo_boq_items (
  item_id       integer primary key,          -- = FACT.ITEM_ID (= ENGG_BOQ_ITEMS.ID)
  wo_id         integer not null,
  boq_id        integer,
  category_id   integer,
  subcategory_id integer,
  quantity      numeric not null default 0,   -- ordered qty
  rate          numeric not null default 0,
  amt           numeric not null default 0,
  boq_name      text,
  boq_subname   text,
  description   text,
  uom           text,
  uom_id        integer,
  synced_at     timestamptz not null default now()
);
create index if not exists in4_wo_boq_items_wo_idx on public.in4_wo_boq_items (wo_id);

create table if not exists public.in4_wo_abstract_items (
  abstract_id        integer not null,        -- = ENGG_BOQ_ABSTRACT.ID (the certificate/bill)
  item_id            integer not null,        -- joins to in4_wo_boq_items.item_id
  wo_id              integer not null,
  executed_quantity  numeric not null default 0,   -- certified qty in this bill
  recommended_rate   numeric not null default 0,
  executed_amt       numeric not null default 0,
  bill_no            text,
  display_no         text,
  abstract_dt        date,
  synced_at          timestamptz not null default now(),
  primary key (abstract_id, item_id)
);
create index if not exists in4_wo_abstract_items_wo_idx on public.in4_wo_abstract_items (wo_id);
create index if not exists in4_wo_abstract_items_item_idx on public.in4_wo_abstract_items (item_id);

do $$
declare t text;
begin
  foreach t in array array['in4_wo_boq_items','in4_wo_abstract_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null)', t || '_read', t);
  end loop;
end $$;

-- The feed's shadow/live switch, like the other feeds. 'false' = shadow: mirror
-- the tables only. (There is no hub-state write yet — the live branch is
-- reserved for surfacing ordered+certified into Cost Control's item rows.)
insert into public.app_settings (key, value) values ('in4_boq_live', 'false')
on conflict (key) do nothing;
