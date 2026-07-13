-- Smart-layer enrichment for the Command Centre (additive, idempotent).
-- priority: 0-100 (higher = do sooner); is_vip: sender is a named senior;
-- reason: why it's ranked here; sender_email: clean address for reply compose;
-- ecc_runs.brief: AI daily-brief snapshot for the run.
alter table public.ecc_items add column if not exists priority     int     not null default 0;
alter table public.ecc_items add column if not exists is_vip       boolean not null default false;
alter table public.ecc_items add column if not exists reason       text;
alter table public.ecc_items add column if not exists sender_email text;

alter table public.ecc_runs  add column if not exists brief        text;

create index if not exists ecc_items_user_priority_idx on public.ecc_items(user_id, priority desc);
