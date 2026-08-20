-- Per (chat, working sheet) Telegram message thread, so each approval-stage
-- update can reply to the previous one — the manager taps a message and Telegram
-- walks the chain back (raised -> PH -> Atm -> Trustee -> released -> IN4).
create table if not exists public.cc_tg_progress_threads (
  chat_id         text not null,
  ws_id           uuid not null references public.cc_working_sheets(id) on delete cascade,
  last_message_id bigint,
  updated_at      timestamptz not null default now(),
  primary key (chat_id, ws_id)
);
alter table public.cc_tg_progress_threads enable row level security;
