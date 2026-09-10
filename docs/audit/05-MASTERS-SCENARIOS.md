# Masters — developer's-hat review, 9 Sep 2026

Fifty scenarios walked through the six Masters screens (`/masters` on `revamp-trial` @ c3f7a44) as five people would use them: Aksha on a phone between site visits, the accounts clerk checking a GST number, an engineer looking up a material, the Trustee skimming, an admin fixing a mapping. Each row says what was found and what was done. "Fixed" rows shipped in Step 9 (one commit).

| # | Who / where | Scenario | Found | Done |
|---|---|---|---|---|
| 1 | Aksha, landing | Which card do I need? | Six cards, numbered in mind-map order, a count and two facts each. Fine. | — |
| 2 | Accounts clerk, landing | "Is Pidilite a vendor or a contractor?" — has to guess a card, open it, search, guess again. | No search across masters. | **Fixed**: a search box on the landing and a `/masters/search?q=` page that looks in all six at once and links each hit to its screen with the search already typed. |
| 3 | Anyone, landing | How fresh is this? | No sync time anywhere. | **Fixed**: "IN4 mirror last synced …" on the landing; live pages already say "live from IN4". |
| 4 | Phone, landing | Cards on a 375 px screen | One column, 44 px targets. Fine. | — |
| 5 | Anyone | First open, slow IN4 | `masters/loading.tsx` skeleton exists. Fine. | — |
| 6 | Accounts clerk, Trusts | Read SRET's GST and registered address | Both present, GST in mono. Fine. | — |
| 7 | Accounts clerk, Trusts | SRASSK has no GST — is that a bug? | Said in words: "No GST registration on record in IN4". Fine. | — |
| 8 | Aksha, Trusts | Which projects does SRASSK pay for? | List opens under the trust — but the three IN4 placeholder "projects" named after trusts (0 work orders) sit among the buildings. | **Fixed**: projects sorted by work orders, most first; a project with none is marked "no work orders". |
| 9 | Aksha, Trusts | Long addresses on a phone | Wrap correctly. Fine. | — |
| 10 | Anyone, Trusts | The chevron's tooltip | Says "Show the item-wise BOQ — 5 items (unit, qty, rate, amount)" on a trust's project list. Wrong words, inherited from the Cost Control tree. | **Fixed**: the shared toggle takes a label; every Masters screen names what opens ("projects", "sub-projects", "sub-categories", "BOQ items"). Cost Control unchanged. |
| 11 | Aksha, Projects | Find "Raj Uphaar" among 36 | No search; scroll. | **Fixed**: search box (`?q=`) on the page — matches project or sub-project name/code; matching sub-projects shown open. |
| 12 | Aksha, Projects | Placeholder projects (SRM Trust, Warehouse, Fixed Assets) clutter the list | Mixed with the buildings. | **Fixed**: two groups — projects with work orders first, "other IN4 projects (no work orders)" below, collapsed. |
| 13 | Trustee, Projects | Is this project running late? | Start/end shown; nothing said when the end date has passed. | **Fixed**: "end date passed" tag on an active project or sub-project whose IN4 end date is behind us. |
| 14 | Admin, Projects | An IN4 sub-project with work orders that feeds no CT Hub project | Silently shows no "CT Hub:" line. | **Fixed**: "not linked to a CT Hub project" tag with a link to Name mapping. |
| 15 | Anyone, Projects | Status chip | Only when not "Approved". Fine. | — |
| 16 | Phone, Projects | Sub-project rows | Wrap, 44 px chevrons. Fine. | — |
| 17 | Aksha, Contacts | First landing on Contacts | Opens on SRMD Team (mind-map order). Counts on every pill. Fine. | — |
| 18 | Aksha, Contacts | Team list includes contractor login accounts | A `contractor`-role login is not the SRMD team. | **Fixed**: Team = CT Hub users without the contractor role; the note says so. |
| 19 | Accounts clerk, Contacts | Vendor's full address | Only city was shown. | **Fixed**: address under the city, with pin. |
| 20 | Accounts clerk, Contacts | "None in IN4" in red italics in four columns on half the rows | Alarming noise for ordinary absence. | **Fixed**: an em dash, muted. Red is kept for a value that is present but wrong (see 21). |
| 21 | Accounts clerk, Contacts | A GSTIN or PAN that cannot be right | Not checked. | **Fixed**: shape check (GSTIN 15 chars 22AAAAA0000A1Z5 pattern, PAN AAAAA0000A); a wrong one is red with "looks wrong". |
| 22 | Aksha, Contacts | The same firm twice in IN4 (JANAK BHAVSAR #223/#225, TRUPTI RAVI PANCHAL #224/#243, UTTARA #162/#163, RITESHKUMAR #120/#242) | Shown as separate rows with nothing said — the scattering Masters is meant to expose. | **Fixed**: "duplicate of #id in IN4" under the name, amber row; count in the header. |
| 23 | Aksha, Contacts | What makes someone a "consultant"? | Not explained on the page. | **Fixed**: one line under the pills. |
| 24 | Anyone, Contacts | Search across groups — typed "Pidilite" under Contractors, nothing | Search is per group. | Covered by the landing search (2). A hint under an empty result points there. **Fixed**. |
| 25 | Accounts clerk, Contacts | Take the vendor list to Excel | No export. | **Fixed**: "Download CSV" on every Masters table (the rows as shown, after search). |
| 26 | Anyone, Contacts | Inactive parties | Tagged, amber. Fine. | — |
| 27 | Engineer, Categories | Find "Waterproofing" | No search. | **Fixed**: search box; matches shown open. |
| 28 | Engineer, Categories | Old categories | Inactive hidden until asked; link shows the count. Fine. | — |
| 29 | Anyone, Categories | Codes | Shown in mono beside the name; name without its number prefix. Fine. | — |
| 30 | Engineer, Items | 4,041 rows on a phone | Capped at 500 with "search to narrow". Sort applies before the cap. Fine. | — |
| 31 | Engineer, Items | "none in IN4" in red under HSN on 4,034 rows | Same noise as 20. | **Fixed**: muted dash; the column header says IN4 holds an HSN for 7 materials. |
| 32 | Engineer, Items | Land here from the landing search | Search box empty again. | **Fixed**: `?q=` pre-fills the table's search. |
| 33 | Engineer, Items | Rate column | "IN4 rate", blank when zero. Fine. | — |
| 34 | Aksha, BOQ | Civil has 217 BOQ names, 1,061 items — find "waterproofing" | Collapsed groups, no search. | **Fixed**: search box; matching groups shown open with only the matching items. |
| 35 | Aksha, BOQ | Is this a real master? | Said plainly: built from work orders, IN4 keeps no BOQ master. Fine. | — |
| 36 | Aksha, BOQ | Rate range and last ordered | Present. Fine. | — |
| 37 | Anyone, BOQ | Back to categories | Link at top. Fine. | — |
| 38 | Anyone, nav | Nine entries on a phone | Horizontal scroll, no scrollbar. Fine. | — |
| 39 | Anyone, nav | Stores and Name mapping — are they masters? | Set apart after a divider. Fine. | — |
| 40 | Anyone, any page | IN4 down | Amber one-liner saying what came from the mirror instead. Fine. | — |
| 41 | Anyone, any page | Numbers and dates | Indian grouping, IST dates. Fine. | — |
| 42 | Admin | Two Masters sections exist: `/masters` and the older `/admin/masters` | Two places for one thing. | Left as is — folding needs Aksha's word (asked 9 Sep). |
| 43 | Anyone, Trusts | PAN "NA" on SRMD Fixed Assets | Shown as "Recorded as 'NA' in IN4". Fine. | — |
| 44 | Developer | Dead code after the rebuild | `lib/revamp/masters.ts` trimmed to Stores. Fine. | — |
| 45 | Developer | Tests | Pure helpers tested (consultants, tree, address). Search/flags added to the tests in Step 9. | **Fixed** |
| 46 | Developer | Every IN4 statement | Run once against live before shipping. | — |
| 47 | Phone, Trusts | Field labels above values | Stack on narrow screens. Fine. | — |
| 48 | Anyone | Keyboard | Chevrons are buttons with aria-expanded; search inputs labelled. Fine. | — |
| 49 | Accounts clerk, Contacts | Copy a GSTIN | Select-and-copy; no button. Left — a copy button is a client widget for a marginal gain. | — |
| 50 | Aksha | A master that is wrong in IN4 (duplicate, invalid GSTIN) — where to fix it | The page says "in IN4". Masters is read-only by design; fixes happen in IN4. | — |

**Net:** 18 fixed, 4 left with a reason, 28 already fine.
