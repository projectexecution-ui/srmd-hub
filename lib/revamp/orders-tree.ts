// Budget vs Actual, pill 2 — "Category — WO/PO wise" (build order §2).
//
// The orders tree: work orders and purchase orders together, on the SAME spine
// as the Internal Estimate — category → sub-category — so a figure here traces
// to the same row there.
//
// Everything is live IN4, mirrored. No figure is derived except Balance, which
// is a subtraction of two amounts IN4 holds (§10).
//
// ── WHAT THE DATA ACTUALLY LOOKS LIKE, checked on NGH B before building ──
//
// 1. A work order carries BOTH `category_id` and `subcategory_id`, and both
//    point into `in4_skills` (a two-level tree: parent_id 0 = category).
// 2. A purchase order does NOT. Indent lines carry a single `skill_id`, and on
//    every line checked it is a TOP-LEVEL category — never a sub-category. So
//    POs can only be placed at category level. They get their own row saying
//    so, rather than being pushed into a sub-category IN4 never assigned.
// 3. 6 of NGH B's 29 work orders have NO sub-category. They get a stated row
//    too. Dropping them would lose ₹ from a total that still claims to be one.
// 4. `pos` is a JSON ARRAY and 19 of NGH B's lines carry TWO purchase orders.
//    Reading `pos->0` — which is the obvious thing to write — silently loses
//    the second one on every one of those lines. Always unnest.
// 5. 402 PO lines resolve to 74 distinct PO numbers. Counting lines would
//    report 402 "orders". The count is of DISTINCT po numbers.
// 6. Four PO lines are drafts. A draft is not committed money, so it is out of
//    the totals and said out loud rather than quietly dropped.
// 7. Work-order `status` is an undecoded integer (2 and 6 appear). It is not
//    shown: inventing labels for codes nobody has mapped is exactly the
//    guessing §10 forbids.

import { createClient } from '@/lib/supabase/server'

export interface OrdersSubRow {
  id: string
  name: string
  kind: 'wo' | 'po'
  /** Distinct orders behind this row. */
  count: number
  ordered: number
  /** WO only — IN4's PO feed carries no payment, so this is null there and
   *  the column shows an em-dash rather than a zero. */
  paid: number | null
  /** True where IN4 holds no sub-category, so the row can say why it exists. */
  unassigned?: boolean
}

export interface OrdersCatRow {
  id: string
  name: string
  subs: OrdersSubRow[]
  count: number
  ordered: number
  paid: number | null
}

export interface OrdersTree {
  cats: OrdersCatRow[]
  totals: { ordered: number; paid: number; woCount: number; poCount: number }
  /** Stated facts about this project's data — shown under the table, never
   *  silently applied. */
  notes: string[]
  /** No confirmed IN4 link yet: the tree cannot be built, and that is a
   *  mapping gap rather than "no orders". */
  linked: boolean
  error: string | null
}

const EMPTY: OrdersTree = {
  cats: [], totals: { ordered: 0, paid: 0, woCount: 0, poCount: 0 },
  notes: [], linked: false, error: null,
}

export interface WoRow {
  wo_id: number
  category_id: number | null
  subcategory_id: number | null
  wo_value: number | null
  wo_paid_amt: number | null
}
export interface IndentRow { skill_id: number | null; pos: unknown }
export interface PoEntry { poNo?: string; amount?: number; draft?: boolean }

export async function loadOrdersTree(projectId: string): Promise<OrdersTree> {
  const supabase = await createClient()

  // Project → IN4 sub-projects, through the two HUMAN-CONFIRMED link tables.
  // Never a name match: attaching another building's orders to this project
  // would be worse than showing none.
  const { data: links, error: linkErr } = await supabase
    .from('cc_bph_project_links').select('bph_project_id').eq('cc_project_id', projectId)
  if (linkErr) return { ...EMPTY, error: linkErr.message }
  const bphIds = (links ?? []).map(r => r.bph_project_id as string).filter(Boolean)
  if (bphIds.length === 0) return EMPTY

  const { data: subLinks, error: subErr } = await supabase
    .from('in4_subproject_links').select('subproject_id').in('bph_project_id', bphIds)
  if (subErr) return { ...EMPTY, error: subErr.message }
  const subIds = [...new Set((subLinks ?? []).map(r => r.subproject_id as number))]
  if (subIds.length === 0) return EMPTY

  // Deliberately NOT widened to sibling sub-projects the way the CT-wise pill
  // is. That pill LISTS each sub-project, so widening is visible; here the
  // figures would silently fold a neighbouring building into this project's
  // categories.
  const [woRes, indentRes] = await Promise.all([
    supabase.from('in4_work_orders')
      .select('wo_id, category_id, subcategory_id, wo_value, wo_paid_amt')
      .in('subproject_id', subIds),
    supabase.from('in4_indent_items')
      .select('skill_id, pos')
      .in('subproject_id', subIds),
  ])
  if (woRes.error) return { ...EMPTY, linked: true, error: woRes.error.message }
  if (indentRes.error) return { ...EMPTY, linked: true, error: indentRes.error.message }

  const wos = (woRes.data ?? []) as WoRow[]
  const indents = (indentRes.data ?? []) as IndentRow[]

  // Skill names for every category and sub-category referenced.
  const skillIds = new Set<number>()
  for (const w of wos) {
    if (w.category_id != null) skillIds.add(w.category_id)
    if (w.subcategory_id != null) skillIds.add(w.subcategory_id)
  }
  for (const i of indents) if (i.skill_id != null) skillIds.add(i.skill_id)

  const nameById = new Map<number, string>()
  if (skillIds.size > 0) {
    const { data: skills, error: skErr } = await supabase
      .from('in4_skills').select('id, name').in('id', [...skillIds])
    if (skErr) return { ...EMPTY, linked: true, error: skErr.message }
    for (const s of (skills ?? []) as Array<{ id: number; name: string | null }>) {
      if (s.name) nameById.set(s.id, s.name)
    }
  }

  return { ...buildOrdersTree(wos, indents, nameById), linked: true, error: null }
}

/**
 * The grouping, split out from the fetch so every figure on this screen is
 * produced by a pure function with a test around it — the build order's rule:
 * "Every figure-producing function gets a test with a real IN4 case and its
 * expected rupee value." The NGH B numbers in orders-tree.test.ts are read
 * from the live mirror, not invented.
 */
export function buildOrdersTree(
  wos: WoRow[], indents: IndentRow[], nameById: Map<number, string>,
): Omit<OrdersTree, 'linked' | 'error'> {
  // ── Build the tree ──────────────────────────────────────────────────────
  const cats = new Map<string, { name: string; subs: Map<string, OrdersSubRow> }>()
  const catOf = (id: number | null): { key: string; name: string } => {
    if (id == null) return { key: '_none', name: 'No category in IN4' }
    return { key: String(id), name: nameById.get(id) ?? `Category ${id}` }
  }
  const catFor = (key: string, name: string) => {
    let c = cats.get(key)
    if (!c) { c = { name, subs: new Map() }; cats.set(key, c) }
    return c
  }

  let woMissingSub = 0

  for (const w of wos) {
    const { key: ck, name: cn } = catOf(w.category_id)
    const cat = catFor(ck, cn)
    const hasSub = w.subcategory_id != null
    if (!hasSub) woMissingSub++
    const sk = hasSub ? `wo:${w.subcategory_id}` : 'wo:_nosub'
    const sname = hasSub
      ? (nameById.get(w.subcategory_id as number) ?? `Sub-category ${w.subcategory_id}`)
      : 'No sub-category in IN4'
    let row = cat.subs.get(sk)
    if (!row) {
      row = { id: `${ck}::${sk}`, name: sname, kind: 'wo', count: 0, ordered: 0, paid: 0, unassigned: !hasSub }
      cat.subs.set(sk, row)
    }
    row.count += 1
    row.ordered += Number(w.wo_value ?? 0)
    row.paid = (row.paid ?? 0) + Number(w.wo_paid_amt ?? 0)
  }

  // Purchase orders: unnest the array (see note 4), skip drafts (note 6), and
  // count DISTINCT po numbers (note 5).
  const poNumbers = new Map<string, Set<string>>()  // category key → po numbers
  let draftLines = 0
  let draftAmount = 0

  for (const i of indents) {
    const arr = Array.isArray(i.pos) ? (i.pos as PoEntry[]) : []
    if (arr.length === 0) continue
    const { key: ck, name: cn } = catOf(i.skill_id)
    for (const po of arr) {
      const amount = Number(po?.amount ?? 0)
      if (po?.draft) { draftLines++; draftAmount += amount; continue }
      const cat = catFor(ck, cn)
      let row = cat.subs.get('po')
      if (!row) {
        row = { id: `${ck}::po`, name: 'Purchase orders', kind: 'po', count: 0, ordered: 0, paid: null }
        cat.subs.set('po', row)
      }
      row.ordered += amount
      const no = String(po?.poNo ?? '').trim()
      if (no) {
        const set = poNumbers.get(ck) ?? new Set<string>()
        set.add(no)
        poNumbers.set(ck, set)
        // Count is filled in below from the distinct set.
      }
    }
  }
  for (const [ck, set] of poNumbers) {
    const row = cats.get(ck)?.subs.get('po')
    if (row) row.count = set.size
  }

  // ── Shape, sort, total ──────────────────────────────────────────────────
  const out: OrdersCatRow[] = [...cats.entries()].map(([key, c]) => {
    // Work-order rows first (they carry the sub-category detail), then the PO
    // row, then the unassigned bucket last so it never heads the list.
    const subs = [...c.subs.values()].sort((a, b) => {
      if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1
      if (a.kind !== b.kind) return a.kind === 'wo' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
    const paidKnown = subs.some(s => s.paid != null)
    return {
      id: key,
      name: c.name,
      subs,
      count: subs.reduce((s, r) => s + r.count, 0),
      ordered: subs.reduce((s, r) => s + r.ordered, 0),
      paid: paidKnown ? subs.reduce((s, r) => s + (r.paid ?? 0), 0) : null,
    }
  }).sort((a, b) => b.ordered - a.ordered)

  const totals = {
    ordered: out.reduce((s, c) => s + c.ordered, 0),
    paid: out.reduce((s, c) => s + (c.paid ?? 0), 0),
    woCount: wos.length,
    poCount: new Set([...poNumbers.values()].flatMap(s => [...s])).size,
  }

  const notes: string[] = []
  notes.push(
    'Work orders carry a category and a sub-category in IN4. Purchase orders carry only a '
    + 'category, so they sit on one row per category rather than being placed under a '
    + 'sub-category IN4 never assigned.',
  )
  if (woMissingSub > 0) {
    notes.push(
      `${woMissingSub} work order${woMissingSub === 1 ? ' has' : 's have'} no sub-category in IN4. `
      + 'They are shown on their own row so their value still reaches the total.',
    )
  }
  if (draftLines > 0) {
    notes.push(
      `${draftLines} draft purchase-order line${draftLines === 1 ? '' : 's'} `
      + `(₹${Math.round(draftAmount).toLocaleString('en-IN')}) `
      + 'are excluded — a draft is not a committed order.',
    )
  }
  notes.push('Paid is what IN4 holds against work orders. Its purchase-order feed carries no payment, so that column is blank on PO rows.')

  return { cats: out, totals, notes }
}
