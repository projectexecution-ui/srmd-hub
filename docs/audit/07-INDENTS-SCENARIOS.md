# Indents — revamp review, 10 Sep 2026

Aksha: "Indent section needs a revamp." Thirty-four scenarios across the two places indents live — each project's **Indents tab** (Step 8) and the portal-wide **Indent → PO Tracker** (`/procurement-tracker`, until now fed by an Excel upload) — as an engineer, a purchase clerk, an Atm Head and Aksha would use them. What was found; what Step 12 did.

| # | Who / where | Scenario | Found | Done |
|---|---|---|---|---|
| 1 | Aksha, screenshot of NGH | Mataseal T6: indented 2,000, PO'd 1,900, received 1,900 — the row said "PO to be raised" | IN4 knows better: the store closed the line for PO (`CLOSED_FOR_PO`, 191 lines carry it). Our arithmetic overrode IN4's decision. | **Fixed**: IN4's flag wins; the line reads "received in full · closed for PO in IN4 at 1,900". |
| 2 | Atm Head | How long has this indent waited at Verify? | Pending list showed the date and days. Fine. | — |
| 3 | Purchase clerk | Which approved indents have no PO, and for how long? | The tree said "PO to be raised" but not since when. | **Fixed**: every line says what it waits for, since when, and for how many days — measured from the step in IN4's audit trail (approval for a PO, PO approval for a delivery). |
| 4 | Atm Head | Which of those are late? | No notion of late. | **Fixed**: late by the same SLA the digest uses — approval or PO 2 days, delivery 7 days. Amber ring on the cycle step, "— late" on the line, a "late" count on the indent, a **Late** chip, and a KPI. |
| 5 | Engineer | Show me only what waits for a PO | Everything at once. | **Fixed**: chips — All · Waiting for approval · Awaiting PO · Awaiting delivery · Late · Received in full; matching branches open by themselves. |
| 6 | Everyone | The same rows in the project tab and the tracker read differently | Two code paths would drift. | **Fixed**: one set of row components (`IndentRows.tsx`) used by both. |
| 7 | Purchase clerk | All projects at once, live | The portal tracker read an Excel upload (two files, twice a day at best). | **Fixed**: `/procurement-tracker` is live from IN4 by default — every project, grouped by IN4's own project, no CT Hub mapping needed. Upload view one click away. |
| 8 | Purchase clerk | Which project needs me first? | — | **Fixed**: project pills carry the number of open items; projects with approvals waiting come first. |
| 9 | Atm Head | Approvals waiting anywhere | Per project only. | **Fixed**: one list across projects on the tracker, project named on each row, oldest first. |
| 10 | Purchase clerk | Old indents still open should not vanish after a year | Twelve-month window would hide them. | **Fixed**: the window is 12 months **plus** any older indent still waiting for anything (approval, an open line without a PO, an undelivered PO). |
| 11 | Engineer | Open the PO or its ledger from the indent | Only on the WO/PO tree. | **Fixed**: PO and ledger links on every PO line under an item. |
| 12 | Aksha | Cancelled indents clutter | Hidden, counted. Fine. | — |
| 13 | Everyone | Who raised it, who verified it, who approved it | On the cycle strip's tooltips and the chain. Fine. | — |
| 14 | Engineer | What the store said when it verified | The IN4 remark is in the tooltip. Fine. | — |
| 15 | Purchase clerk | A PO at Verify blocks the line | Reads "waiting for PO approval", now with days and lateness. **Fixed** (4). | |
| 16 | Phone | The tree on 375 px | Cards under md; chevrons 44 px. Fine. | — |
| 17 | Everyone | Numbers | Indian grouping, IST dates. Fine. | — |
| 18 | Aksha | Indent value | IN4 holds no rate on most indent lines (rate null on IND …/151). PO'd and Received carry the money. Left as is — inventing a value is worse than none. | — |
| 19 | Purchase clerk | Chase notes and "closed projects" | Live in the upload-based tracker; still there under Upload. Moving them needs a decision on where notes attach (IN4 id vs upload row). | Later |
| 20 | Atm Head | The daily digest e-mail | Still built from the upload. Switching it to the live rows is a small next step once Aksha confirms the SLA numbers. | Later |
| 21 | Everyone | IN4 down | Says so, offers the upload-based view. Fine. | — |
| 22 | Developer | Cycle logic tested | Pure builder, 12 cases including closed-for-PO, late-by-SLA, chips. **Fixed** | |
| 23 | Developer | Every IN4 statement | Run once against live. | — |
| 24 | Aksha | Module tile text | Still said "Upload IN4 … report". | **Fixed**: "Live from IN4 — every indent's cycle…". |
| 25 | Engineer | A material name that IN4 abbreviates | Full material name from the register. Fine. | — |
| 26 | Purchase clerk | Received partly | "Received 1,900 of 2,000" on the strip, per PO under the item. Fine. | — |
| 27 | Atm Head | What did it cost? | PO'd (landed, with GST) and Received value per line and rolled up. Fine. | — |
| 28 | Everyone | Sub-project vs project | Project tab is by CT Hub project (via the confirmed mapping); tracker by IN4 project, sub-project shown on the indent. Fine. | — |
| 29 | Purchase clerk | Filter by project and stage together | **Fixed**: pills and chips combine in the URL. | |
| 30 | Aksha | Keep the old tracker? | Kept under "Upload-based tracker" until chase notes and the digest move. | — |
| 31 | Everyone | Loading | Route-level skeleton exists; the all-projects read is ~4–8 s on 800 indents. Acceptable; a cache is the next step if it grows. | — |
| 32 | Head | Which supplier is slow to deliver? | Per supplier on the Masters contact record (lead time). Fine. | — |
| 33 | Engineer | Which indents are mine? | Not yet — needs IN4 user ↔ CT Hub user mapping. | Later |
| 34 | Aksha | Approve from here | No — approval stays in IN4 (Aksha, 9 Sep). The Atm Head is told when it is their turn (Step 8 watcher). | — |

**Net:** 12 fixed, 3 later with a reason, 19 already fine.
