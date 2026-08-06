-- Who's accountable + who executes, per work item. Mirrors the Zoho
-- Owner (responsible engineer) and Approver; contractor is new (Zoho didn't
-- track it — the hub's vendors list feeds the picker). All nullable text.
alter table public.sched_items
  add column if not exists owner_name    text,
  add column if not exists contractor    text,
  add column if not exists approver_name text;
