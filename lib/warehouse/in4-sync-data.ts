import { createClient } from '@/lib/supabase/server'
import { in4Key } from './in4-items'
import { plan } from './in4-sync'
import type { SyncLine, SyncExisting, SyncPlan } from './in4-sync'

/** Reading the daily IN4 uploads and working out what would come across.
 *
 *  Reads BOTH tracker slots. The Warehouse PO screen only ever read `global`,
 *  which meant the 596 lines the PO report contributes to slot `po` were
 *  invisible to it — including their rates. */

type RawPo = {
  poNo?: string; poDate?: string; supplier?: string
  rate?: number | string; qty?: number | string; draft?: boolean; inferred?: boolean
}
type RawLine = {
  material?: string; uom?: string; discipline?: string
  indentNo?: string; project?: string; pos?: RawPo[]
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[₹$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Every line from both slots. Deliberately NOT de-duplicated across slots: the
 *  planner keys items and POs itself, so a line appearing in both is harmless
 *  and the PO slot is often the only one carrying a rate. */
export async function readTrackerLines(): Promise<{ lines: SyncLine[]; slots: string[]; error?: string }> {
  const sb = await createClient()
  const { data, error } = await sb.from('procurement_tracker_state').select('id, state')
  if (error) return { lines: [], slots: [], error: error.message }

  const lines: SyncLine[] = []
  const slots: string[] = []
  for (const row of data ?? []) {
    slots.push(row.id)
    const projects = (row.state as { projects?: Array<{ lines?: RawLine[] }> } | null)?.projects ?? []
    for (const p of projects) {
      for (const l of p.lines ?? []) {
        lines.push({
          material: String(l.material ?? ''),
          uom: l.uom?.trim() || null,
          discipline: l.discipline?.trim() || null,
          indentNo: l.indentNo?.trim() || null,
          project: l.project?.trim() || null,
          pos: (l.pos ?? []).map(p2 => ({
            poNo: p2.poNo?.trim() || null,
            poDate: p2.poDate?.trim() || null,
            supplier: p2.supplier?.trim() || null,
            rate: num(p2.rate),
            qty: num(p2.qty),
            draft: Boolean(p2.draft),
            inferred: Boolean(p2.inferred),
          })),
        })
      }
    }
  }
  return { lines, slots }
}

/** What the warehouse already holds, keyed for the planner. */
export async function readExisting(): Promise<{ have: SyncExisting; error?: string }> {
  const sb = await createClient()
  const [itemsRes, listsRes, posRes, projectsRes] = await Promise.all([
    sb.from('wh_items').select('id, name, unit, in4_name').is('deleted_at', null),
    sb.from('wh_lists').select('kind, value'),
    sb.from('wh_po').select('po_no').is('deleted_at', null),
    sb.from('projects').select('id, name'),
  ])
  const error = itemsRes.error?.message ?? listsRes.error?.message
    ?? posRes.error?.message ?? projectsRes.error?.message

  const have: SyncExisting = {
    byIn4Key: new Map(), byNameKey: new Map(),
    units: new Set(), disciplines: new Set(), poNos: new Set(), projectsByName: new Map(),
  }
  for (const i of itemsRes.data ?? []) {
    if (i.in4_name) have.byIn4Key.set(in4Key(i.in4_name), { id: i.id, unit: i.unit })
    const nk = in4Key(i.name)
    // First one wins: two hand-typed items with the same name would make
    // adoption ambiguous, and the planner refuses to adopt in that case anyway.
    if (nk && !have.byNameKey.has(nk)) have.byNameKey.set(nk, { id: i.id, unit: i.unit })
  }
  for (const l of listsRes.data ?? []) {
    if (l.kind === 'unit') have.units.add(l.value)
    if (l.kind === 'discipline') have.disciplines.add(l.value)
  }
  for (const p of posRes.data ?? []) have.poNos.add(p.po_no)
  for (const p of projectsRes.data ?? []) {
    const k = in4Key(p.name)
    if (k) have.projectsByName.set(k, p.id)
  }
  return { have, error }
}

export type SyncPreview = {
  plan: SyncPlan
  slots: string[]
  lineCount: number
  error?: string
}

/** The dry run. Reads everything, writes nothing. */
export async function getSyncPreview(): Promise<SyncPreview> {
  const [tracker, existing] = await Promise.all([readTrackerLines(), readExisting()])
  const error = tracker.error ?? existing.error
  const p = plan(tracker.lines, existing.have)
  return { plan: p, slots: tracker.slots, lineCount: tracker.lines.length, error }
}
