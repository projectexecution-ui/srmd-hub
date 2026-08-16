# Categorising the item master — 2026-08-16

Aksha: *"dont consider Diciplines in Stock Inventory - rather the Categories
which already i had used in Warehouse V1"* … *"U Use AI and find out - read
each one and Get me Answer to it and ask before u apply."*

## Why the discipline had to go

What the code called `discipline` is IN4's **budget head**, not a material
family: `07 Electrical Works`, `19 Site Admin`, `56 Mock Up Expense`,
`01 Site Pre`. Grouping a store by those reads as nonsense — "Mock Up Expense"
is not a kind of material. `groupOf()` used to fall back to it whenever an item
had no category, which was 2,288 of 2,803 items.

## How the 2,288 were categorised

Eight AI readers, 300 items each, reading every name individually rather than
pattern-matching. The IN4 budget-head prefix (`105 (M) Site Prelims Plumbing
Works-1.5'' G.I UNION`) was stripped first, so a GI union bought under Site
Prelims still reads as Plumbing. Three of the eight MD5-verified their id list
against the database.

Merged result: 2,288 read, 2,288 unique, 0 duplicates, 0 malformed, 0 invented
categories. The per-item result is in `warehouse-item-categories-20260816.csv`.

## Disagreements between readers, and the single ruling applied to each

| Theme | Split | Ruling |
|---|---|---|
| Drainage chamber & manhole covers | 14 Civil / 12 Plumbing | **Civil** — a casting the infra team lays, not pipework |
| Medical gas strays | 60 Plumbing / 4 Misc | joined the rest, then all became **MGPS** |
| Water cooler / RO | 5 Plumbing / 2 Site | **Plumbing** — plumbed-in appliances follow the water |
| Saddles vs clamps | 33 Hardware / 5 elsewhere | **Hardware** — a saddle is a clamp by another name |
| Cable ties | Hardware / Electrical | **Hardware** — with every other tie-down |

## Aksha's four decisions

1. **All 7 new categories accepted** — HVAC, ICT, Civil, Fire Fighting,
   Site & Consumables, Landscape, Waterproofing. His V1 ten came from Yunus,
   an MEP store, and could not cover whole trades.
2. **Furniture & Furnishings** gets its own category (30 items: beds, chairs,
   curtains, mattresses). Misc keeps only plant — a reach truck, a pallet
   truck, a flour mill, a dock bumper.
3. **MGPS** gets its own category (62 items). Driven by IN4's `10 MGPS` head,
   because by NAME medical-gas copper is indistinguishable from plumbing
   copper. **Two Sintex water tanks on that head were deliberately excluded**
   and left in Plumbing — the caveat raised before he decided.
4. **The 16 unreadable names → Misc** (`SUN`, `SU 11`, `Pellets`, `RTU 90`,
   `CCTV Live Monitoring`, `UPS & ITS BATTERY WARRANTY`, …). Names that carry
   no material, plus three that are services rather than stock.

Three V1 labels were folded after reading all nine of their items:
`Electrical Accessories` → Electrical · `Fasteners` → Hardware ·
`Finishes & Hardware` → Hardware (brackets, fixing bolts) and
Site & Consumables (two granite storage stands). All three are deactivated in
`wh_lists`, never deleted.

## Final state

2,803 items, **zero uncategorised**, 16 categories:

Electrical 950 · Plumbing 766 · Finishes 185 · Hardware 163 · Sanitaryware 97 ·
ICT 95 · Lighting 91 · Civil 83 · Site & Consumables 78 · HVAC 74 · MGPS 62 ·
Fire Fighting 57 · Misc 31 · Furniture & Furnishings 30 · Landscape 28 ·
Waterproofing 13
