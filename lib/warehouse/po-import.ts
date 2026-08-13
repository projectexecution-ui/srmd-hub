import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { aliasKey, suggestItems, type Suggestion } from './match'
import { getItems } from './data'

/** Reading POs out of the Indent → PO Tracker.
 *
 *  The tracker is refreshed by Aksha's weekly IN4 upload and already holds
 *  1,195 PO numbers with supplier, date, ordered qty and UOM — so a PO HEADER
 *  imports perfectly. The LINES carry IN4's generic material names, which match
 *  our item master only 1.3% of the time, so each line gets a suggestion for a
 *  human to confirm once; the confirmed pairing is then remembered as an alias. */

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

export type TrackerPoLine = {
  sourceText: string
  uom: string | null
  orderedQty: number
  receivedQty: number
  rate: number | null
  discipline: string | null
  /** Set when this material has been confirmed before — no thinking needed. */
  aliasItemId: string | null
  suggestions: Suggestion[]
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

/** One PO's lines, each with an alias hit or ranked suggestions. */
export async function getTrackerPo(poNo: string): Promise<{
  poNo: string; vendor: string | null; poDate: string | null; project: string | null
  indentNos: string[]; alreadyImported: boolean; lines: TrackerPoLine[]
} | null> {
  const [lines, items, sb] = await Promise.all([readTracker(), getItems(), createClient()])

  const mine = lines.filter(l => (l.pos ?? []).some(p => p.poNo === poNo && !p.draft))
  if (mine.length === 0) return null

  const first = (mine[0].pos ?? []).find(p => p.poNo === poNo)
  const keys = [...new Set(mine.map(l => aliasKey(l.material ?? '')).filter(Boolean))]
  const [{ data: aliases }, { data: existing }] = await Promise.all([
    sb.from('wh_item_aliases').select('alias_key, item_id').in('alias_key', keys.length ? keys : ['']),
    sb.from('wh_po').select('id').eq('po_no', poNo).maybeSingle(),
  ])
  const aliasMap = new Map((aliases ?? []).map(a => [a.alias_key, a.item_id]))

  // The tracker repeats a material once per indent; the PO ordered one total.
  const merged = new Map<string, TrackerPoLine>()
  for (const l of mine) {
    const text = (l.material ?? '').trim()
    if (!text) continue
    const key = aliasKey(text)
    const ref = (l.pos ?? []).find(p => p.poNo === poNo)
    const cur = merged.get(key)
    if (cur) {
      cur.orderedQty += Number(l.orderedQty ?? 0)
      cur.receivedQty += Number(l.receivedQty ?? 0)
      continue
    }
    merged.set(key, {
      sourceText: text,
      uom: l.uom ?? null,
      orderedQty: Number(l.orderedQty ?? 0),
      receivedQty: Number(l.receivedQty ?? 0),
      rate: ref?.rate ? Number(ref.rate) : null,
      discipline: l.discipline ?? null,
      aliasItemId: aliasMap.get(key) ?? null,
      suggestions: aliasMap.has(key) ? [] : suggestItems(text, items),
    })
  }

  return {
    poNo,
    vendor: first?.supplier ?? null,
    poDate: first?.poDate ?? null,
    project: mine[0].project ?? null,
    indentNos: [...new Set(mine.map(l => l.indentNo).filter(Boolean) as string[])],
    alreadyImported: !!existing,
    lines: [...merged.values()].sort((a, b) => b.orderedQty - a.orderedQty),
  }
}

/** Aliases already learned, for the Settings screen later. */
export async function getAliasCount(): Promise<number> {
  const sb = await createClient()
  const { count } = await sb.from('wh_item_aliases').select('id', { count: 'exact', head: true })
  return count ?? 0
}
