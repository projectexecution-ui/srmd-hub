-- N3 — an approval notice clears itself when the work is done.
--
-- Aksha, 17 Sep 2026, after seeing the read rates: of 1,205 notifications
-- 1,089 are unread, and 424 of those are `approval_pending` on working sheets.
-- They are not ignored because people do not care; they are unread because
-- nobody goes back to tick off a notice for a budget they approved days ago.
-- Two Heads sit at 100% unread. The bell reached "99+" and stopped meaning
-- anything, which is what makes the genuinely new item invisible.
--
-- So the notice clears itself. The moment a sheet's status moves, every unread
-- "waiting on you" notice for THAT sheet is marked read — for everyone it was
-- sent to, not just whoever acted. One sheet notifies about four eligible
-- approvers; when one of them signs, the other three are holding a notice for
-- work that is no longer theirs to do.
--
-- Why a trigger and not the approve action: the status moves from several
-- places — the Cost Control screens, the Telegram act-as-approver webhook, and
-- any RPC — and a rule that lives in one of them is a rule the others break.
-- The status column is the truth, so the trigger hangs off the status.
--
-- Ordering is safe. components/cost-control/ws-actions.ts updates the status
-- FIRST and dispatches the next stage's cards afterwards (`after(() => …)`),
-- so this fires before the next approver's notice exists and can never wipe a
-- fresh one.
--
-- Deliberately narrow: only `approval_pending`, only rows tied to this sheet,
-- only ones still unread. It never deletes, so the notice stays in the
-- register and on the "see all" list — it simply stops counting as waiting.

create or replace function public.fn_cc_clear_stale_approval_notices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    update public.notifications
       set is_read = true,
           read_at = now()
     where doc_table = 'cc_working_sheets'
       and doc_id    = new.id
       and type      = 'approval_pending'
       and read_at is null;
  end if;
  return new;
end $$;

comment on function public.fn_cc_clear_stale_approval_notices() is
  'Marks a working sheet''s unread approval_pending notices read for every recipient as soon as its status moves. Never deletes.';

drop trigger if exists trg_cc_ws_clear_stale_notices on public.cc_working_sheets;
create trigger trg_cc_ws_clear_stale_notices
after update of status on public.cc_working_sheets
for each row execute function public.fn_cc_clear_stale_approval_notices();
