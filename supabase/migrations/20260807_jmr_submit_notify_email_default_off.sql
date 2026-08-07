-- Instant approver ping on JMR submit (jmr_entry_submitted) should NOT email by
-- default — an engineer can log many entries a day and 5 approvers × per-entry
-- email would flood inboxes. In-app + phone push stay on (notification_allowed
-- falls back to true when no rule says otherwise). Admins can flip email on from
-- the Notifications page. Idempotent.
insert into public.notification_rules (scope, scope_key, event_type, channel, enabled)
values ('global', '', 'jmr_entry_submitted', 'email', false)
on conflict (scope, scope_key, event_type, channel) do update
  set enabled = excluded.enabled;
