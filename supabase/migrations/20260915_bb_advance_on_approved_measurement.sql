-- Applied live on 15 Sep 2026. Recorded here so the schema is reproducible.
--
-- The Site Head does not click Forward. He measures once in IN4; when IN4
-- approves that measurement the bill moves itself to the CT Disc Head.
--
-- Aksha, 15 Sep 2026: "he has to make Abstract and GRN in IN4 after it
-- approves it should go to CT DISC HEAD AUTO."
--
-- And the return half: the Disc Head sends back with a mandatory reason, the
-- Site Head revises in IN4, and when that revision is approved the bill comes
-- back for review. So "approved" alone is not enough -- it has to be a
-- DIFFERENT approval from the one already seen, or a bill would bounce straight
-- back having changed nothing. Hence the fingerprint below.
--
-- The full body of bb_measurement_ref() and bb_rpc_advance_measured() is in the
-- database; this file records the shape and the reasoning.
alter table public.bb_bills add column if not exists measured_ref text;
alter table public.in4_wo_abstract_items add column if not exists approved_at timestamptz;
