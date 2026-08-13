import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { in4Key, planIn4Items, cleanUom } from './in4-items'

/** Reading POs out of the Indent → PO Tracker.
 *
 *  The tracker is refreshed by Aksha's weekly IN4 upload and holds 1,195 PO
 *  numbers with supplier, date, ordered qty, UOM and rate. All of it imports
 *  as-is: IN4's material name IS the item (see in4-items.ts), so there is
 *  nothing to map, confirm or guess. What actually turns up at the gate is a
 *  separate question, answered at the gate. */

type TrackerPoRef = { poNo?: string; poDate?: string; supplier?: string; rate?: number; qty?: number; draft?: boolean }
type TrackerLine = {
  material?: string; uom?: string; orderedQty?: number; receivedQty?: number
  pos?: TrackerPoRef[]; indentNo?: string; project?: string; discipline?: string
}

export type TrackerPoSummary = {
  poNo: string
  vendor: string | null
  poDate: string | null
  project: string | null
  lineCount: number
  /** Already imported into Warehouse V2? */
  imported: boolean
}

/** One PO line, exactly as IN4 sent it. */
export type TrackerPoLine = {
  /** IN4's material name, trimmed and otherwise untouched. */
  material: string
  uom: string | null
  orderedQty: number
  receivedQty: number
  rate: number | null
  discipline: string | null
  /** Do we already hold an item for this IN4 name, or will importing create one? */
  itemExists: boolean
  /** The unit we already hold, when it disagrees with the UOM IN4 sent. */
  ourUnit: string | null
}

const readTracker = cache(async (): Promise<TrackerLine[]> => {
  const sb = await createClient()
  const { data } = await sb
    .from('procurement_tracker_state')
    .select('state')
    .eq('id', 'global')
    .maybeSingle()
  const projects = (data?.state as { projects?: Array<{ lines?: TrackerLine[] }> } | null)?.projects ?? []
  return projects.flatMap(p => p.lines ?? [])
})

/** POs available to import, newest first. `q` filters on PO number or vendor. */
export async function searchTrackerPos(q = '', limit = 25): Promise<TrackerPoSummary[]> {
  const [lines, sb] = await Promise.all([readTracker(), createClient()])
  const needle = q.trim().toLowerCase()

  const byPo = new Map<string, { vendor: string | null; poDate: string | null; project: string | null; lines: number }>()
  for (const l of lines) {
    for (const po of l.pos ?? []) {
      if (!po.poNo || po.draft) continue
      const cur = byPo.get(po.poNo)
      if (cur) { cur.lines++; continue }
      byPo.set(po.poNo, {
        vendor: po.supplier ?? null,
        poDate: po.poDate ?? null,
        project: l.project ?? null,
        lines: 1,
      })
    }
  }

  let list = [...byPo.entries()].map(([poNo, v]) => ({
    poNo, vendor: v.vendor, poDate: v.poDate, project: v.project, lineCount: v.lines, imported: false,
  }))
  if (needle) {
    list = list.filter(p =>
      p.poNo.toLowerCase().includes(needle) || (p.vendor ?? '').toLowerCase().includes(needle))
  }
  // Newest first. IN4 dates are "Apr 22, 2023" — parseable, and anything
  // unparseable sorts last rather than throwing.
  list.sort((a, b) => (Date.parse(b.poDate ?? '') || 0) - (Date.parse(a.poDate ?? '') || 0))
  list = list.slice(0, limit)

  const { data: already } = await sb
    .from('wh_po')
    .select('po_no')
    .in('po_no', list.map(p => p.poNo))
  const have = new Set((already ?? []).map(r => r.po_no))
  return list.map(p => ({ ...p, imported: have.has(p.poNo) }))
}

export type TrackerPo = {
  poNo: string
  vendor: string | null
  poDate: string | null
  project: string | null
  indentNos: string[]
  alreadyImported: boolean
  lines: TrackerPoLine[]
  /** Items this import would create, because IN4 has named material we have
   *  never received before. Not a problem — just worth seeing first. */
  newItems: number
  /** IN4 sent the same material with two different UOMs on this PO. */
  uomConflicts: Array<{ name: string; kept: string | null; alsoSeen: string }>
  /** Lines IN4 sent with no material name — they cannot be imported. */
  unnamed: number
}

/** One PO, ready to import as-is. */
export async function getTrackerPo(poNo: string): Promise<TrackerPo | null> {
  const [lines, sb] = await Promise.all([readTracker(), createClient()])

  const mine = lines.filter(l => (l.pos ?? []).some(p => p.poNo === poNo && !p.draft))
  if (mine.length === 0) return null

  const first = (mine[0].pos ?? []).find(p => p.poNo === poNo)
  const plan = planIn4Items(mine)

  // The tracker repeats a material once per indent; the PO ordered one total.
  const merged = new Map<string, TrackerPoLine>()
  for (const l of mine) {
    const material = (l.material ?? '').trim()
    const key = in4Key(material)
    if (!key) continue
    const ref = (l.pos ?? []).find(p => p.poNo === poNo)
    const cur = merged.get(key)
    if (cur) {
      cur.orderedQty += Number(l.orderedQty ?? 0)
      cur.receivedQty += Number(l.receivedQty ?? 0)
      if (!cur.rate && ref?.rate) cur.rate = Number(ref.rate)
      continue
    }
    merged.set(key, {
      material: plan.wanted.get(key)?.name ?? material,
      uom: plan.wanted.get(key)?.uom ?? cleanUom(l.uom),
      orderedQty: Number(l.orderedQty ?? 0),
      receivedQty: Number(l.receivedQty ?? 0),
      rate: ref?.rate ? Number(ref.rate) : null,
      discipline: plan.wanted.get(key)?.discipline ?? null,
      itemExists: false,
      ourUnit: null,
    })
  }

  // Which of these IN4 names we already hold an item for.
  const keys = [...merged.keys()]
  const { data: existing } = keys.length
    ? await sb.from('wh_items').select('id, in4_name, unit').not('in4_name', 'is', null).is('deleted_at', null)
    : { data: [] as Array<{ id: string; in4_name: string | null; unit: string }> }
  const have = new Map(
    (existing ?? [])
      .filter(r => r.in4_name)
      .map(r => [in4Key(r.in4_name!), r.unit]),
  )
  for (const [key, line] of merged) {
    const ourUnit = have.get(key)
    if (ourUnit) {
      line.itemExists = true
      line.ourUnit = line.uom && ourUnit !== line.uom ? ourUnit : null
    }
  }

  const { data: alreadyPo } = await sb.from('wh_po').select('id').eq('po_no', poNo).maybeSingle()

  return {
    poNo,
    vendor: first?.supplier ?? null,
    poDate: first?.poDate ?? null,
    project: mine[0].project ?? null,
    indentNos: [...new Set(mine.map(l => l.indentNo).filter(Boolean) as string[])],
    alreadyImported: !!alreadyPo,
    lines: [...merged.values()].sort((a, b) => b.orderedQty - a.orderedQty),
    newItems: [...merged.values()].filter(l => !l.itemExists).length,
    uomConflicts: plan.uomConflicts,
    unnamed: plan.unnamed,
  }
}
