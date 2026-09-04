import { createClient } from '@/lib/supabase/server'
import { getTrackerSlots } from '@/lib/procurement/tracker-cache'
import { in4Key } from './in4-items'
import { fetchAll } from './paging'
import { loadAliasMap } from '@/lib/aliases'
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
  // Cached at the source (lib/procurement/tracker-cache), which also does the
  // id ordering — without it the database may hand the slots back either way
  // round, and anything that takes the FIRST value it sees for an item (its
  // unit) could differ between two runs over identical data.
  let data: Array<{ id: string; state: unknown }>
  try {
    data = await getTrackerSlots(await createClient())
  } catch (e) {
    return { lines: [], slots: [], error: e instanceof Error ? e.message : 'tracker read failed' }
  }

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
  // Items and POs are PAGED. PostgREST returns at most 1,000 rows and says
  // nothing about the rest; wh_items passed that in August, so the planner saw
  // 1,000 of 2,803 items, decided the other 1,803 were new, and every upload's
  // sync died on wh_items_in4_key_idx ("duplicate key") for two weeks.
  const [itemsRes, listsRes, posRes, projectsRes] = await Promise.all([
    fetchAll<{ id: string; name: string; unit: string; in4_name: string | null }>((from, to) =>
      sb.from('wh_items').select('id, name, unit, in4_name').is('deleted_at', null).order('id').range(from, to)),
    sb.from('wh_lists').select('kind, value'),
    fetchAll<{ po_no: string }>((from, to) =>
      sb.from('wh_po').select('id, po_no').is('deleted_at', null).order('id').range(from, to)),
    sb.from('projects').select('id, name'),
  ])
  // The alias table (Admin → Project name mapping) is consulted alongside the
  // exact hub name, so a project the upload spells IN4's way ("New Guest
  // House", "Ekant Kutirs") still lands on the right hub project.
  const aliases = await loadAliasMap(sb, 'procurement').catch(() => null)
  const in4Aliases = await loadAliasMap(sb, 'in4').catch(() => null)
  const error = itemsRes.error ?? listsRes.error?.message
    ?? posRes.error ?? projectsRes.error?.message ?? undefined

  const have: SyncExisting = {
    byIn4Key: new Map(), byNameKey: new Map(),
    units: new Set(), disciplines: new Set(), poNos: new Set(), projectsByName: new Map(),
  }
  for (const i of itemsRes.rows) {
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
  for (const p of posRes.rows) have.poNos.add(p.po_no)
  for (const p of projectsRes.data ?? []) {
    const k = in4Key(p.name)
    if (k) have.projectsByName.set(k, p.id)
  }
  for (const m of [in4Aliases, aliases]) {
    if (!m) continue
    for (const [norm, { projectId }] of m) {
      // in4Key() and the alias normalisation agree (lower-case, non-alphanumerics
      // to single spaces), so the alias key is already the planner's key.
      if (projectId && !have.projectsByName.has(norm)) have.projectsByName.set(norm, projectId)
    }
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
