# Revamp changelog — the overnight run of 8–9 Sep 2026

Branch `revamp-trial` only. Nothing touched `main`, the live site, or the database.
Starting point before this run: commit `8de570f`. Every step below is one commit;
to undo a step, `git revert <sha>` on revamp-trial and push.

| Step | Commit | What changed | How to verify on the trial site |
|---|---|---|---|
| Step 1 — Trial site safe (audit P0) | see `git log` "Step 1" | `lib/demo-mode.ts` now allows only the 23 named read RPCs and blocks every other `rpc()` (F-001 — 31 browser-side writers were reaching the live DB). Service-role GETs outside `/api/cron/` refuse on the trial (F-003 Zoho callback, F-005 backup + in4-followup). Un-paged reads of growing tables paged (F-002 CT-wise certificates — Raj Uphaar's 1,987 rows; F-013 JMR). One demo expression (F-011). | Any Cost Control approval → Approve → the "trial site" message, and `cc_approvals` unchanged. Raj Uphaar → Budget → CT wise → Certified rises to `sum(certified_amt)` for project 8. |
| Step 2 — UX quick wins | see `git log` "Step 2" | UX items 2 (project filter in the sidebar), 10 (pills: By category · By order · By CT), 13 (one dash + legend), 15 (one % used colour rule + legend), 21 (SC Budgets Save shows the trial message instead of a 403), 32 (Not-linked states offer "Link it in Masters → Mapping" to reviewers), 33 (the gear says "Setup"), 36 (loading skeletons for the workspace and Masters), 41 (no text under 12 px in the workspace; 44 px chevrons and Print on phones). Item 7 (deep-link to a category) deferred — needs the approval-card link format checked first. | Sidebar: type "ngh" → the tree narrows. Open any project → skeleton for a moment, then Budget pills read By category / By order / By CT. SC Budgets on the trial: the Save button is a message with a link to live. |
