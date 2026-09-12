-- Rollback for 20260912_site_register.sql
--
-- The Site Register is purely additive — nine new tables, five new functions
-- and one app_settings row. Nothing existing was altered, so undoing it is
-- dropping what was added. Running this DESTROYS every entry, stakeholder and
-- recorded specification; take a copy first if the data matters.
--
-- To take the pages away WITHOUT losing the data, do not run this. Set the
-- three workspace tabs back to `built: false` in lib/revamp/tabs.ts and
-- lib/revamp/workspace.ts, or switch them off per role on /admin/permissions.

begin;

drop function if exists public.sr_record_decision(uuid, text, text, date);
drop function if exists public.sr_create_thread(uuid, text, text, text, uuid, uuid, uuid, text, text, uuid, uuid, date, numeric, text, uuid[], jsonb);

drop table if exists public.sr_decision_revisions  cascade;
drop table if exists public.sr_decision_items      cascade;
drop table if exists public.sr_thread_watchers     cascade;
drop table if exists public.sr_thread_events       cascade;
drop table if exists public.sr_thread_posts        cascade;
drop table if exists public.sr_threads             cascade;
drop table if exists public.sr_stakeholders        cascade;
drop table if exists public.sr_project_disciplines cascade;
drop table if exists public.sr_disciplines         cascade;

drop function if exists public.sr_threads_freeze();
drop function if exists public.sr_can_write();
drop function if exists public.sr_can_admin();
drop function if exists public.sr_is_admin();

delete from public.app_settings where key = 'sr_escalation_days';

commit;
