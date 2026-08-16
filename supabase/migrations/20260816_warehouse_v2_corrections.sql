-- Warehouse V2 — the four things an admin could not do.
--
--   1. Void a gate entry that was recorded wrong.
--   2. Add, rename or retire a store / site.
--   3. Mark returnable material as actually returned.
--   4. Fix, retire or merge an item in the master.
--
-- Only additive: one new movement kind, three new columns. Nothing existing
-- changes shape, so every current query keeps working untouched.

-- ---------------------------------------------------------------------------
-- 1 · A void is its own kind of movement.
--
-- The ledger is append-only, so undoing an entry means posting the arithmetic
-- inverse of what it posted, not deleting rows. That reversal could have been
-- filed as `adjust`, but `adjust` means "a physical count found a difference".
-- Mixing a keeper's typo into that bucket would make the count-variance report
-- read as if the store had lost 500 bags, which is exactly the wrong story.
-- ---------------------------------------------------------------------------
alter type wh_movement_kind add value if not exists 'void';

-- ---------------------------------------------------------------------------
-- 2 · Why it was voided.
--
-- deleted_at / deleted_by already existed and were never written. The reason is
-- the part that matters months later: "wrong store" and "truck never came" are
-- very different facts about the same voided entry.
-- ---------------------------------------------------------------------------
alter table wh_gate_in  add column if not exists void_reason text;
alter table wh_gate_out add column if not exists void_reason text;

-- ---------------------------------------------------------------------------
-- 3 · Where a merged item went.
--
-- Two rows for one material is inevitable when 2,803 items arrive from IN4 and
-- keepers can add more at the gate. Merging folds one into the other; this
-- column is what lets a stale link or an old report still resolve to the item
-- that survived, instead of hitting a deleted row and showing "—".
-- ---------------------------------------------------------------------------
alter table wh_items add column if not exists merged_into uuid references wh_items(id);

create index if not exists wh_items_merged_into_idx
  on wh_items (merged_into) where merged_into is not null;
