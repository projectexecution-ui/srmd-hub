-- The Daily Bills Report used to keep one app_settings row per IST day
-- (bills_pipeline_report_2026-08-16, _17, …). Wave 1 (20260904_wave1_hygiene)
-- copied them into bills_pipeline_reports and left the keys in place until the
-- new reader was on main. It has been since 5 Sept 2026, so the keys go.
--
-- Revertible: every row lives on in bills_pipeline_reports (report_date,
-- payload); to restore the old keys run
--   insert into app_settings (key, value)
--   select 'bills_pipeline_report_' || report_date, payload from bills_pipeline_reports
--   on conflict (key) do nothing;
-- The "latest" pointer (bills_pipeline_report) is untouched.

insert into public.bills_pipeline_reports (report_date, payload)
select substring(key from 23)::date, value
from public.app_settings
where key ~ '^bills_pipeline_report_\d{4}-\d{2}-\d{2}$'
on conflict (report_date) do nothing;

delete from public.app_settings
where key ~ '^bills_pipeline_report_\d{4}-\d{2}-\d{2}$';
