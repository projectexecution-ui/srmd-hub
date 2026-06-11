-- BPH sync hardening: in-place ERP figure changes and stale-line zeroing
-- now emit audit events. New cc_event_type value for "figures changed in
-- place" (budget_add / budget_remove stay reserved for true grants/cuts).
-- Applied to live as migration cc_budget_update_event_type (2026-06-11).
alter type public.cc_event_type add value if not exists 'budget_update';
