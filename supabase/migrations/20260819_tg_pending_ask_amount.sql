-- Remember the sheet's ask amount on the pending sign-off, so the approver can
-- reply with JUST a remark (the checked amount defaults to the ask) — or type a
-- different amount first to override.
alter table public.tg_pending_approvals add column if not exists ask_amount numeric;
