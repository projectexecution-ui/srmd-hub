-- Remember the approval card's Telegram message id on the pending sign-off, so
-- once the approver types their amount we can strip the buttons off the original
-- card (no stale "Approve" left tappable after it's done).
alter table public.tg_pending_approvals add column if not exists card_message_id bigint;
