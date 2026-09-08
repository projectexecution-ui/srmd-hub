// Read-time corrections to Indent → PO tracker lines on the revamp.
//
// The tracker snapshot (procurement_tracker_state) is written by the LIVE
// site's sync from IN4's PURCH_INDENT_TO_ISSUE view, which has two habits the
// feed copied (fixed in lib/in4 on this branch, dormant until merged):
//
//   1. It reports a PO line's quantity as the PO's TOTAL for that material,
//      so a PO whose one material sits on two lines (PO/SRASSK/NGH/2025-26/93:
//      44,200 kg + 70 kg) shows 44,270 on both. 424 of 4,714 lines, 70.8 lakh.
//   2. It joins every GRN of a PO to every indent line of the PO, so a line
//      carries the other line's GRNs at 0 kg. 54 rows on 47 lines.
//
// Until the feed fix runs on live, the revamp corrects the lines it shows:
// the PO line's own quantity and value come live from IN4's PO-details fact
// (BI.FACT_PURCHASE_ORDER_DETAILS), matched to a tracker line by IDS — the
// mirror row in in4_indent_items gives the indent id and material id, found
// through the SAME deterministic material string the tracker builds — never a
// fuzzy name match. A line that cannot be matched unambiguously is left as it
// is. GRN rows of nothing are dropped. Every corrected figure is IN4's own.

import { cleanMaterial } from '@/lib/procurement/shared'
import { excelMaterialCell } from '@/lib/in4/tracker'
import { in4Query, in4Config } from '@/lib/in4/db'
import { sqlLiteral } from './orders-tree'

type L = Record<string, unknown>

/** The mirror's identity for one indent line (in4_indent_items). */
export interface MirrorItem {
  indent_no: string; indent_id: number; material_id: number
  material_type: string; material_subtype: string; material_name: string
}
/** One PO line as IN4's PO-details fact holds it, keyed the way the tracker
 *  can reach it: PO number + indent id + material id. */
export interface PoLineFix { poNo: string; indentId: number; materialId: number; qty: number; value: number }

export interface Corrections { poLinesCorrected: number; grnRowsDropped: number; linesUnmatched: number }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/** The key the tracker and the mirror share: indent number + the cleaned
 *  material string both are built from with the same function. */
export function lineKey(indentNo: string, material: string): string {
  return `${indentNo.trim()}|${material.trim().toLowerCase()}`
}

export function correctTrackerLines(lines: readonly L[], items: readonly MirrorItem[], fixes: readonly PoLineFix[]): { lines: L[]; corrections: Corrections } {
  // Mirror items by key; a key shared by two items is ambiguous and unusable.
  const byKey = new Map<string, MirrorItem | null>()
  for (const it of items) {
    const k = lineKey(it.indent_no, cleanMaterial(excelMaterialCell(it)))
    byKey.set(k, byKey.has(k) ? null : it)
  }
  const fixByKey = new Map<string, PoLineFix>()
  for (const f of fixes) fixByKey.set(`${f.poNo.trim()}|${f.indentId}|${f.materialId}`, f)

  const c: Corrections = { poLinesCorrected: 0, grnRowsDropped: 0, linesUnmatched: 0 }
  const out = lines.map(src => {
    const l: L = { ...src }
    let changed = false

    const grns = (Array.isArray(l.grns) ? l.grns : []) as L[]
    const kept = grns.filter(g => num(g.qty) > 0 || num(g.value) > 0)
    if (kept.length !== grns.length) { c.grnRowsDropped += grns.length - kept.length; l.grns = kept; changed = true }

    const pos = (Array.isArray(l.pos) ? l.pos : []) as L[]
    if (pos.length) {
      const item = byKey.get(lineKey(String(l.indentNo ?? ''), String(l.material ?? '')))
      if (item === undefined || item === null) {
        if (fixes.length) c.linesUnmatched++
      } else {
        l.pos = pos.map(po => {
          const fix = fixByKey.get(`${String(po.poNo ?? '').trim()}|${item.indent_id}|${item.material_id}`)
          if (!fix || po.draft || Math.abs(fix.qty - num(po.qty)) < 1e-6) return po
          c.poLinesCorrected++
          changed = true
          const rate = fix.qty > 0 ? fix.value / fix.qty : num(po.rate)
          return { ...po, qty: fix.qty, rate, amount: Math.round(fix.value * 100) / 100 }
        })
      }
    }

    if (changed) {
      const ps = l.pos as L[]
      const gs = l.grns as L[]
      const orderedQty = ps.reduce((s, p) => s + num(p.qty), 0)
      const receivedQty = gs.reduce((s, g) => s + num(g.qty), 0)
      const pendingQty = Math.max(orderedQty - receivedQty, 0)
      const firstRate = num(ps.find(p => num(p.rate))?.rate) || num(gs.find(g => num(g.rate))?.rate)
      l.orderedQty = orderedQty
      l.receivedQty = receivedQty
      l.pendingQty = pendingQty
      l.pendingValue = pendingQty * firstRate
      l.grnValue = gs.reduce((s, g) => s + num(g.value), 0)
      l.status = ps.length === 0 ? 'no_po' : receivedQty <= 0 ? 'pending' : receivedQty < orderedQty ? 'partial' : 'received'
    }
    return l
  })
  return { lines: out, corrections: c }
}

/** The minimum a Supabase client needs here — small so a test can stub it. */
export interface ItemReader {
  from(table: string): {
    select(cols: string): {
      in(col: string, values: string[]): {
        range(f: number, t: number): PromiseLike<{ data: unknown; error: { message: string } | null }>
      }
    }
  }
}

/** Fetch what correctTrackerLines needs for these lines: the mirror identities
 *  of their indent lines, and IN4's own PO-line figures for their POs. Returns
 *  `live: false` (and nothing to correct with) when IN4 is not configured or
 *  cannot be reached — the lines then show as the snapshot holds them. */
export async function loadTrackerFixes(
  supabase: ItemReader,
  lines: readonly L[],
): Promise<{ items: MirrorItem[]; fixes: PoLineFix[]; live: boolean }> {
  const indentNos = [...new Set(lines.map(l => String(l.indentNo ?? '').trim()).filter(Boolean))]
  const poNos = [...new Set(lines.flatMap(l => ((Array.isArray(l.pos) ? l.pos : []) as L[])
    .filter(p => !p.draft).map(p => String(p.poNo ?? '').trim())).filter(Boolean))]
  if (!in4Config() || poNos.length === 0) return { items: [], fixes: [], live: false }

  const items: MirrorItem[] = []
  for (let i = 0; i < indentNos.length; i += 100) {
    const chunk = indentNos.slice(i, i + 100)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('in4_indent_items')
        .select('indent_no, indent_id, material_id, material_type, material_subtype, material_name')
        .in('indent_no', chunk).range(from, from + 999)
      if (error) return { items: [], fixes: [], live: false }
      const batch = (data ?? []) as MirrorItem[]
      items.push(...batch)
      if (batch.length < 1000) break
    }
  }

  const fixes: PoLineFix[] = []
  try {
    const lits = poNos.map(sqlLiteral).filter((s): s is string => s != null)
    for (let i = 0; i < lits.length; i += 300) {
      const rows = await in4Query<Record<string, unknown>>(`
        SELECT h.PO_NO, d.INDENT_ID, d.MATERIAL_ID, MAX(d.BASE_PO_QTY) QTY, MAX(d.MATERIAL_VALUE) VALUE
        FROM BI.FACT_PURCHASE_ORDER_DETAILS d
        JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = d.PO_ID
        WHERE h.PO_NO IN (${lits.slice(i, i + 300).join(',')})
        GROUP BY h.PO_NO, d.INDENT_ID, d.MATERIAL_ID`)
      for (const r of rows) {
        fixes.push({ poNo: String(r.PO_NO ?? '').trim(), indentId: num(r.INDENT_ID), materialId: num(r.MATERIAL_ID), qty: num(r.QTY), value: num(r.VALUE) })
      }
    }
  } catch {
    return { items: [], fixes: [], live: false }
  }
  return { items, fixes, live: true }
}
