-- Command Centre smart layer: Auto-Summarize (one-line "what they want")
-- + Instant-Reply chips (short reply intents). Additive, idempotent.
alter table public.ecc_items add column if not exists summary       text;
alter table public.ecc_items add column if not exists smart_replies text[] not null default '{}';
