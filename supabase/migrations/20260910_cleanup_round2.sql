-- Clean-up round 2 — the chase feature and the upload-based Indent → PO tracker
-- (Aksha, 10 Sep 2026: "use live IN4 database here … remove chase feature").
-- Indents are read live from IN4; nothing below is read by the code any more.
-- Backup copies first, into the same schema round 1 used. Idempotent.

create schema if not exists cleanup_backup_20260910;
do $$
declare t text;
begin
  foreach t in array array['procurement_tracker_state','procurement_tracker_state_history','procurement_chase_notes','procurement_dropped_lines'] loop
    if to_regclass('public.' || t) is not null and to_regclass('cleanup_backup_20260910.' || t) is null then
      execute format('create table cleanup_backup_20260910.%I as table public.%I', t, t);
    end if;
  end loop;
end $$;
create table if not exists cleanup_backup_20260910.app_settings_removed_round2 as
  select * from public.app_settings where key like 'procurement\_notify\_%' escape '\' or key in ('procurement_closed_projects','in4_tracker_live','in4_last_sync_tracker');
create table if not exists cleanup_backup_20260910.notification_rules_removed_round2 as
  select * from public.notification_rules where event_type = 'procurement_digest';

drop table if exists public.procurement_chase_notes, public.procurement_dropped_lines, public.procurement_tracker_state_history, public.procurement_tracker_state cascade;
-- procurement_known_projects and procurement_user_project_visibility stay: the "sees indents" grant on Project setup reads them.

delete from public.notification_rules where event_type = 'procurement_digest';
delete from public.notification_schedule where event_type = 'procurement_digest';
delete from public.app_settings where key like 'procurement\_notify\_%' escape '\' or key in ('procurement_closed_projects','in4_tracker_live','in4_last_sync_tracker');
