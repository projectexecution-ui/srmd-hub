# Masters for every hat — 9 Sep 2026

Aksha: "wear an Engineer, Head, Admin hat — where can all these masters and IN4's rates be used?" Thirty-six scenarios, one per real question, and what the Masters section does about each after Step 11 (`revamp-trial`). Every figure is IN4's own, read live; nothing here writes.

## Engineer — before raising an indent or a BOQ

| # | Question | What Masters does now |
|---|---|---|
| E1 | "What did we pay for GI pipe 25 mm last time, and to whom?" | **Rates → Material purchase rates**: type the name → every PO line (date, PO, supplier, project, qty, rate, value), last rate, min–max, weighted average, cheapest supplier. |
| E2 | "Which supplier should I ask first?" | Same card names the cheapest supplier when more than one supplied, and links each supplier to their record. |
| E3 | "Is this material even in IN4, and under what exact name?" | **Item master** search (4,041 names, codes, types); a hit opens its purchase history. Search all masters finds it from anywhere. |
| E4 | "How was this work described in earlier BOQs, and at what rate?" | **Rates → BOQ work rates**: type "waterproofing" → every work-order BOQ line with contractor, project, date, qty, rate; lowest green, highest amber. |
| E5 | "Which BOQ items exist under Civil, and what did they cost?" | **BOQ master** by category → BOQ name → item, with WOs used in and rate min–max; "who charged what →" on any item used more than once. |
| E6 | "Which sub-category does this belong to?" | **Budget categories**: 92 → 369 with codes, searchable. |
| E7 | "Which store receives this?" | **Stores**: IN4's list with owner project and keeper. |
| E8 | "I can't find the material by our site name." | Search box on the landing looks across items, BOQ names and everything else at once. |
| E9 | "Is this rate an outlier?" | On the material card the lowest paid rate is green, the highest amber, and the spread is stated in %. |
| E10 | "I'm on site on my phone." | Every screen is cards below 768 px; search boxes and chevrons are 44 px. |
| E11 | "Take the rate list to Excel." | Download CSV on every table. |
| E12 | "Open the PO the rate came from." | Every PO line has a Print link to the PO in IN4's own format. |

## Head — sizing up money and people

| # | Question | What Masters does now |
|---|---|---|
| H1 | "Are we paying two prices for one thing?" | **Rates** landing: the 300 materials with the most spend, amber where two or more suppliers were 20 %+ apart (145 such materials); chip "Two prices for one thing". |
| H2 | "How much have we given this contractor, and paid?" | **Contact record** (`/masters/contacts/contractor/<id>`): WOs, ordered with GST, paid, retention held, projects, categories, first → last order, every WO with Ledger and Print. |
| H3 | "How does this supplier deliver?" | Supplier record: PO → first GRN in days on average, POs received in full / partly / not yet. |
| H4 | "Is this supplier's price competitive?" | Supplier record: their average rate against the lowest SRMD paid anyone for the same material, as +%. |
| H5 | "Which projects are running past their date?" | **Projects**: "end date passed" tags and the count on top; Housekeeping lists them. |
| H6 | "Who are the consultants and what did we pay them?" | Contacts → Consultants; each opens a record with their WOs. |
| H7 | "Who is entered twice in IN4?" | Contacts flags duplicates; Housekeeping counts them. |
| H8 | "Which trust pays for what?" | **Trusts**: projects with work orders per trust, addresses, GST, PAN. |
| H9 | "What is still owed on this contractor's orders?" | Each WO's Ledger (running still-to-pay); the Accounts tab per project. |
| H10 | "Which contractors are inactive but still on orders?" | Contacts greys them; Housekeeping counts them. |
| H11 | "Where is the money by category?" | Budget categories with work orders per category; the Budget tab for the project view. |
| H12 | "Give me a one-page view of what needs deciding." | **Housekeeping**: fourteen checks with counts and where each is fixed. |

## Admin & accounts — keeping the two systems in step

| # | Question | What Masters does now |
|---|---|---|
| A1 | "What does IN4 call our project?" | **Name mapping** — the real editor, now under Masters; readable by all, decided by admins. |
| A2 | "Which IN4 sub-projects feed no CT Hub project?" | Projects → CT Hub registry note, and Housekeeping. |
| A3 | "Which CT Hub projects have no IN4 link, so their tabs are empty?" | Projects → CT Hub registry, chip "Not linked to IN4"; Housekeeping. |
| A4 | "Which projects lack an area, so ₹/sft is blank?" | CT Hub registry chip "No area"; one click "Use IN4 area" where IN4 has one. |
| A5 | "Which contact names were typed into CT Hub and never registered in IN4?" | Contacts → "In CT Hub only", with the pin-to-IN4 picker. |
| A6 | "Which Warehouse items does IN4 not know?" | Items → "Warehouse vs IN4", with the picker. |
| A7 | "Which CT Hub store cannot take an IN4 GRN?" | Stores, chip "Not in IN4", with the picker. |
| A8 | "Do our category codes mean the same thing as IN4's?" | Budget categories → "CT Hub vs IN4": agree / name differs / one side only / duplicate code. |
| A9 | "Which GST or PAN numbers will bounce?" | Contacts: shape check, "looks wrong" in red; Housekeeping counts them. |
| A10 | "What's the one list of everything to fix?" | **Housekeeping** — admin / accounts / Head sections, each row says fix in IN4 or in CT Hub and opens the page. |
| A11 | "How fresh is the mirror?" | Landing: last sync time. |
| A12 | "Who has which role in CT Hub?" | Contacts → SRMD Team with role labels. |

## Left for later, with a reason

- Rate **trend over time** (chart per material) — the data is on the card; a chart is a second pass once Aksha says which materials matter.
- **Preferred-supplier** flag per material — a decision, not a fact; needs a place to record it (a table).
- **Consultant monthly fees** as a series — visible per WO on the record; a fee table needs Aksha's list of consultants.
