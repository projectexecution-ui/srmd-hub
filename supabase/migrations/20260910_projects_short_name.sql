-- Name layer, Phase 1 (Aksha, 10 Sep 2026): a project's SHORT NAME is a display
-- field of its own, so the "Alias" chip stops rewriting projects.code — the
-- code is a match key (sub-project matcher, BPH links) and the prefix on every
-- Working-Sheet number. Renaming a key to change what people read moves money;
-- a display column does not.
--
-- Fallback everywhere: short_name → code. Null = "show the code", exactly today.
-- Additive and idempotent, for the merge-time auto-apply Action.

alter table public.projects add column if not exists short_name text;
comment on column public.projects.short_name is
  'CT Hub display chip (e.g. "NGH Common"). Falls back to code when null. Never a match key.';

-- Audit: renames and code changes are edits like any other, so they get their
-- own event types in cc_budget_events instead of borrowing a budget one.
-- ADD VALUE is safe inside a transaction as long as nothing in the same
-- transaction inserts the new value — this file only declares them.
alter type public.cc_event_type add value if not exists 'project_renamed';
alter type public.cc_event_type add value if not exists 'project_code_changed';
alter type public.cc_event_type add value if not exists 'project_short_name';
