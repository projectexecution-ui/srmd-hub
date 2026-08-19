-- Let the "test card" dry-run the FULL approval flow (amount+remark prompt,
-- button locking) without mutating anything: a pending row marked is_test just
-- confirms "Test OK" on reply instead of running the engine.
alter table public.tg_pending_approvals add column if not exists is_test boolean not null default false;
