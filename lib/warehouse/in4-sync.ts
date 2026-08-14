/** Syncing the Warehouse masters from the daily IN4 uploads.
 *
 *  The Indent → PO Tracker is already uploaded weekly and already holds more
 *  item names, units and disciplines than any other source we have. This plans
 *  what would come across — and plans it as a DRY RUN, because the only safe way
 *  to move 2,300 items and 1,300 purchase orders is to look at the list first.
 *
 *  Aksha chose five groups: items, units, disciplines, purchase orders and PO
 *  rates. Stores are deliberately not here — he sets those up himself, and the
 *  tracker has no store field anyway. Suppliers, invoices, projects and indents
 *  are left to the parts of the hub that already own them.
 *
 *  Everything in this file is pure: it takes what the tracker says and what the
 *  database already holds, and returns the plan. Nothing here can write.
 */

import { in4Key, in4Name, cleanUom, FALLBACK_UOM } from './in4-items'

export type SyncGroup = 'items' | 'units' | 'disciplines' | 'pos'

/** One tracker line, from either slot, reduced to what the sync needs. */
export type SyncLine = {
  material: string
  uom: string | null
  discipline: string | null
  indentNo: string | null
  project: string | null
  pos: Array<{
    poNo: string | null
    poDate: string | null
    supplier: string | null
    rate: number | null
    qty: number | null
    draft?: boolean
    /** The parser worked this PO out from context — IN4 never gave a number. */
    inferred?: boolean
  }>
}

/** What the database already holds, keyed the way the planner compares. */
export type SyncExisting = {
  /** in4Key(in4_name) → item. Items already linked to an IN4 name. */
  byIn4Key: Map<string, { id: string; unit: string }>
  /** in4Key(name) → item. Catches an item we typed by hand under the same name. */
  byNameKey: Map<string, { id: string; unit: string }>
  units: Set<string>
  disciplines: Set<string>
  poNos: Set<string>
  /** in4Key(project name) → project id. */
  projectsByName: Map<string, string>
}

export type PlannedItem = {
  key: string
  name: string
  unit: string
  discipline: string | null
  /** True when the unit had to be defaulted because IN4 sent none. */
  unitDefaulted: boolean
  /** An item we already had by name, which this will link to its IN4 name
   *  instead of creating a second one that would split its stock. */
  adoptItemId?: string
}

export type PlannedPoLine = { itemKey: string; itemName: string; qty: number; rate: number | null }

export type PlannedPo = {
  poNo: string
  poDate: string | null
  vendor: string | null
  entity: string | null
  indentNo: string | null
  projectId: string | null
  projectName: string | null
  lines: PlannedPoLine[]
}

export type SyncPlan = {
  items: {
    create: PlannedItem[]
    adopt: PlannedItem[]
    alreadyThere: number
    /** IN4's unit disagrees with the unit we already hold. Never auto-changed:
     *  a unit is locked to its item, and re-scaling one silently would corrupt
     *  every quantity ever recorded against it. */
    unitConflicts: Array<{ name: string; ours: string; in4: string }>
    noUom: string[]
  }
  units: {
    create: string[]
    alreadyThere: number
    /** IN4 uses several words for the same unit. Flagged, not merged — which of
     *  them you actually want is your call, not a guess this code should make. */
    synonymGroups: Array<{ label: string; members: string[] }>
  }
  disciplines: { create: string[]; alreadyThere: number }
  pos: {
    create: PlannedPo[]
    alreadyImported: number
    skippedDraft: number
    skippedInferred: number
    /** A PO number with nothing usable on it — no material, or no quantity. */
    skippedEmpty: number
    /** Tracker project names with no matching project in the hub. The PO still
     *  imports; it just carries no project. */
    unmatchedProjects: string[]
  }
  rates: { pricedLines: number; itemsWithARate: number }
  /** Lines IN4 sent with no material name at all — they cannot become items. */
  unnamedLines: number
}

/** IN4's own synonyms. Kept as a list rather than a mapping because "which one
 *  do you want to keep" is a decision about your store, not about data. */
const UNIT_SYNONYMS: Array<{ label: string; members: string[] }> = [
  { label: 'metre',  members: ['Mtr', 'Metre', 'Mts', 'RM', 'RMT'] },
  { label: 'number', members: ['Nos', 'Pcs'] },
  { label: 'packet', members: ['PACKETS', 'Pack', 'Pkt.'] },
  { label: 'bag',    members: ['Bags', 'Bag'] },
  { label: 'tonne',  members: ['MT', 'Ton.'] },
]

/** A PO number we can actually import: real, issued, and named by IN4. */
export function isRealPo(p: SyncLine['pos'][number]): boolean {
  if (!p.poNo || !p.poNo.trim()) return false
  if (p.draft) return false
  if (p.inferred) return false
  if (/^draft/i.test(p.poNo.trim())) return false
  return true
}

/** The entity that raised the indent — "IND/SRASSK/NGH/2024-25/195" → SRASSK. */
export function entityFromIndent(indentNo: string | null | undefined): string | null {
  const parts = String(indentNo ?? '').split('/')
  return parts.length >= 2 && parts[1].trim() ? parts[1].trim() : null
}

export function plan(lines: SyncLine[], have: SyncExisting): SyncPlan {
  // ---------------------------------------------------------------- items
  const wanted = new Map<string, { name: string; uom: string | null; discipline: string | null }>()
  let unnamedLines = 0
  for (const l of lines) {
    const name = in4Name(l.material ?? '')
    const key = in4Key(name)
    if (!name || !key) { unnamedLines++; continue }
    const uom = cleanUom(l.uom)
    const cur = wanted.get(key)
    if (!cur) {
      wanted.set(key, { name, uom, discipline: l.discipline?.trim() || null })
      continue
    }
    // The PO slot carries no UOM at all, so a later line often supplies it.
    if (!cur.uom && uom) cur.uom = uom
    if (!cur.discipline && l.discipline?.trim()) cur.discipline = l.discipline.trim()
  }

  // An item we already typed by hand under the same name should be LINKED, not
  // duplicated — but only when exactly one IN4 name claims it, otherwise the
  // unique index would reject the second and the run would half-fail.
  const claimsByNameKey = new Map<string, number>()
  for (const key of wanted.keys()) {
    if (have.byIn4Key.has(key)) continue
    if (!have.byNameKey.has(key)) continue
    claimsByNameKey.set(key, (claimsByNameKey.get(key) ?? 0) + 1)
  }

  const create: PlannedItem[] = []
  const adopt: PlannedItem[] = []
  const unitConflicts: SyncPlan['items']['unitConflicts'] = []
  const noUom: string[] = []
  let alreadyThere = 0

  for (const [key, spec] of wanted) {
    const mine = have.byIn4Key.get(key)
    if (mine) {
      alreadyThere++
      if (spec.uom && mine.unit !== spec.uom) {
        unitConflicts.push({ name: spec.name, ours: mine.unit, in4: spec.uom })
      }
      continue
    }
    const planned: PlannedItem = {
      key,
      name: spec.name,
      unit: spec.uom ?? FALLBACK_UOM,
      discipline: spec.discipline,
      unitDefaulted: !spec.uom,
    }
    if (!spec.uom) noUom.push(spec.name)

    const byName = have.byNameKey.get(key)
    if (byName && claimsByNameKey.get(key) === 1) {
      // Keep OUR unit: it is already locked to whatever stock that item holds.
      if (spec.uom && byName.unit !== spec.uom) {
        unitConflicts.push({ name: spec.name, ours: byName.unit, in4: spec.uom })
      }
      adopt.push({ ...planned, unit: byName.unit, unitDefaulted: false, adoptItemId: byName.id })
      continue
    }
    create.push(planned)
  }

  // ---------------------------------------------------------------- units
  const in4Units = new Set<string>()
  for (const s of wanted.values()) if (s.uom) in4Units.add(s.uom)
  const unitsCreate = [...in4Units].filter(u => !have.units.has(u)).sort((a, b) => a.localeCompare(b))
  const synonymGroups = UNIT_SYNONYMS
    .map(g => ({ label: g.label, members: g.members.filter(m => in4Units.has(m) || have.units.has(m)) }))
    .filter(g => g.members.length > 1)

  // ---------------------------------------------------------- disciplines
  const in4Disc = new Set<string>()
  for (const s of wanted.values()) if (s.discipline) in4Disc.add(s.discipline)
  const discCreate = [...in4Disc].filter(d => !have.disciplines.has(d)).sort((a, b) => a.localeCompare(b))

  // ------------------------------------------------------------------ POs
  type Acc = {
    poDate: string | null; vendor: string | null; entity: string | null; indentNo: string | null
    projectName: string | null
    lines: Map<string, PlannedPoLine>
  }
  const byPo = new Map<string, Acc>()
  let skippedDraft = 0, skippedInferred = 0
  const seenDraft = new Set<string>(), seenInferred = new Set<string>()
  const unmatched = new Set<string>()
  let pricedLines = 0
  const itemsWithARate = new Set<string>()

  for (const l of lines) {
    const name = in4Name(l.material ?? '')
    const key = in4Key(name)
    for (const p of l.pos ?? []) {
      const no = (p.poNo ?? '').trim()
      if (!no) continue
      if (p.draft || /^draft/i.test(no)) { seenDraft.add(no); continue }
      if (p.inferred) { seenInferred.add(no); continue }
      if (!isRealPo(p)) continue
      if (have.poNos.has(no)) continue          // never touch an imported PO
      if (!key) continue

      const qty = Number(p.qty ?? 0)
      const rate = p.rate && Number(p.rate) > 0 ? Number(p.rate) : null
      if (rate) { pricedLines++; itemsWithARate.add(key) }
      if (!(qty > 0)) continue                  // a line with no quantity is not a line

      if (!byPo.has(no)) {
        byPo.set(no, {
          poDate: p.poDate ?? null,
          vendor: p.supplier?.trim() || null,
          entity: entityFromIndent(l.indentNo),
          indentNo: l.indentNo ?? null,
          projectName: l.project?.trim() || null,
          lines: new Map(),
        })
      }
      const acc = byPo.get(no)!
      if (!acc.vendor && p.supplier?.trim()) acc.vendor = p.supplier.trim()
      const cur = acc.lines.get(key)
      if (cur) {
        // The tracker repeats a material once per indent; the PO ordered one total.
        cur.qty += qty
        if (cur.rate == null && rate != null) cur.rate = rate
      } else {
        acc.lines.set(key, { itemKey: key, itemName: name, qty, rate })
      }
    }
  }
  skippedDraft = seenDraft.size
  skippedInferred = seenInferred.size

  const posCreate: PlannedPo[] = []
  let skippedEmpty = 0
  for (const [poNo, acc] of byPo) {
    if (acc.lines.size === 0) { skippedEmpty++; continue }
    // Matched on the NAME only, and only exactly.
    //
    // The indent number carries a project CODE (IND/SRASSK/NGH/…) and projects
    // has a `code` column, so code-matching looks like the obvious better idea.
    // It is not: code NGH resolves to the hub project "NGH Infra", which is a
    // DIFFERENT project from New Guest House — so every New Guest House PO would
    // be silently filed against Infra. Measured on the live data, code-matching
    // hits 3 of 23 names and one of those 3 is wrong.
    //
    // So no guessing. An unmatched PO comes in with no project, which costs
    // nothing real: the project is asked for at the GATE, when the material
    // actually arrives, and that is the answer the reports use.
    let projectId: string | null = null
    if (acc.projectName) {
      projectId = have.projectsByName.get(in4Key(acc.projectName)) ?? null
      if (!projectId) unmatched.add(acc.projectName)
    }
    posCreate.push({
      poNo,
      poDate: acc.poDate,
      vendor: acc.vendor,
      entity: acc.entity,
      indentNo: acc.indentNo,
      projectId,
      projectName: acc.projectName,
      lines: [...acc.lines.values()].sort((a, b) => b.qty - a.qty),
    })
  }
  posCreate.sort((a, b) => (Date.parse(b.poDate ?? '') || 0) - (Date.parse(a.poDate ?? '') || 0)
    || a.poNo.localeCompare(b.poNo))

  // Every PO number the tracker holds that we already have.
  const allRealPoNos = new Set<string>()
  for (const l of lines) for (const p of l.pos ?? []) if (isRealPo(p)) allRealPoNos.add(p.poNo!.trim())
  let alreadyImported = 0
  for (const no of allRealPoNos) if (have.poNos.has(no)) alreadyImported++

  return {
    items: { create, adopt, alreadyThere, unitConflicts, noUom },
    units: { create: unitsCreate, alreadyThere: in4Units.size - unitsCreate.length, synonymGroups },
    disciplines: { create: discCreate, alreadyThere: in4Disc.size - discCreate.length },
    pos: {
      create: posCreate,
      alreadyImported,
      skippedDraft,
      skippedInferred,
      skippedEmpty,
      unmatchedProjects: [...unmatched].sort((a, b) => a.localeCompare(b)),
    },
    rates: { pricedLines, itemsWithARate: itemsWithARate.size },
    unnamedLines,
  }
}

/** One line per group for the summary strip, in the order Aksha picked them. */
export const GROUP_META: Array<{
  key: SyncGroup
  title: string
  what: string
  /** Why it is safe — what this can and cannot change. */
  safety: string
}> = [
  {
    key: 'items',
    title: 'Items',
    what: 'Every material IN4 names, with its unit and trade',
    safety: 'Only adds. An item you already hold is left exactly as it is — including its unit, '
      + 'which is locked because stock is recorded against it.',
  },
  {
    key: 'units',
    title: 'Units',
    what: 'The units IN4 actually uses on those materials',
    safety: 'Only adds to your Units list. Nothing existing is renamed or switched off.',
  },
  {
    key: 'disciplines',
    title: 'Trades',
    what: 'The trade each material belongs to',
    safety: 'Only adds to your Trades list. This is what the registers and reports group by.',
  },
  {
    key: 'pos',
    title: 'Purchase orders',
    what: 'Issued POs with their lines, quantities and rates',
    safety: 'Only adds POs you do not already have. An imported PO is never touched, so nothing '
      + 'that has already been received against can change. Drafts and parser-guessed POs are skipped.',
  },
]
