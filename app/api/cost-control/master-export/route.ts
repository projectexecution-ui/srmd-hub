// Master Excel export — the single linked workbook management is used to:
// a "Master" summary sheet (Work Category → Sub Skill → Amount, cross-linked)
// plus one working sheet per sub-skill, all internally linked (Master pulls each
// sub-skill's grand total via ='<sheet>'!<cell>). Mirrors the V8 NGH_B format so
// management can keep their familiar file — generated on demand from the app.
// Management-only. Read-only; not behind the experimental flag.

import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'

export const dynamic = 'force-dynamic'

const MONEY = '#,##0'
const S = (v: string) => ({ t: 's', v }) as XLSX.CellObject
const N = (v: number, z?: string) => ({ t: 'n', v, ...(z ? { z } : {}) }) as XLSX.CellObject
const F = (f: string, v: number, z?: string) => ({ t: 'n', v, f, ...(z ? { z } : {}) }) as XLSX.CellObject

// Excel sheet names: <=31 chars, no []:*?/\ , unique.
function sheetName(base: string, used: Set<string>): string {
  let n = base.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let i = 2
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = n.slice(0, 31 - suf.length) + suf }
  used.add(n.toLowerCase())
  return n
}

interface Row { description: string | null; unit: string | null; qty: number | null; rate: number | null; amount: number | null }

export async function GET(req: NextRequest) {
  await requirePermission('cost-control', 'view')
  if (!(await checkIsCcReviewer())) {
    return new Response('Management only', { status: 403 })
  }
  const projectId = req.nextUrl.searchParams.get('project')
  if (!projectId) return new Response('project required', { status: 400 })

  const supabase = await createClient()
  const { data: project } = await supabase.from('projects').select('code, name, built_up_sft').eq('id', projectId).maybeSingle()
  if (!project) return new Response('project not found', { status: 404 })
  const sft = Number(project.built_up_sft) || 0

  // Enabled disciplines + sub-skills for the project.
  const [{ data: pd }, { data: ps }] = await Promise.all([
    supabase.from('cc_project_disciplines').select('discipline_id, cc_disciplines(id, code, name, display_order)').eq('project_id', projectId).eq('is_enabled', true),
    supabase.from('cc_project_sub_skills').select('sub_skill_id, cc_sub_skills(id, discipline_id, code, name)').eq('project_id', projectId).eq('is_enabled', true),
  ])
  type D = { id: string; code: string; name: string; display_order: number }
  type SS = { id: string; discipline_id: string; code: string; name: string }
  const discs: D[] = (pd ?? []).map(r => (Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines)).filter(Boolean) as D[]
  const subs: SS[] = (ps ?? []).map(r => (Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills)).filter(Boolean) as SS[]
  discs.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.code.localeCompare(b.code))

  // Latest LIVE working sheet per (discipline, sub-skill) bucket (exclude
  // [IB] baselines, cancelled, archived). Prefer the newest version.
  const { data: wsAll } = await supabase
    .from('cc_ws_with_versions')
    .select('id, discipline_id, sub_skill_id, line_type, version_no, status, total_amount, summary_notes, archived_at')
    .eq('project_id', projectId)
  const liveBySub = new Map<string, { id: string; total: number }>()
  for (const w of (wsAll ?? [])) {
    if (!w.sub_skill_id) continue
    if ((w.summary_notes ?? '').startsWith('[IB')) continue
    if (w.status === 'cancelled' || w.archived_at) continue
    const cur = liveBySub.get(w.sub_skill_id)
    if (!cur || (w.version_no ?? 0) > ((wsAll ?? []).find(x => x.id === cur.id)?.version_no ?? 0)) {
      liveBySub.set(w.sub_skill_id, { id: w.id, total: Number(w.total_amount) || 0 })
    }
  }

  // Rows for the chosen sheets.
  const wsIds = [...liveBySub.values()].map(v => v.id)
  const rowsByWs = new Map<string, Row[]>()
  if (wsIds.length) {
    const { data: rows } = await supabase
      .from('cc_excel_rows')
      .select('working_sheet_id, row_no, description, unit, qty, rate, amount')
      .in('working_sheet_id', wsIds)
      .order('row_no')
    for (const r of (rows ?? [])) {
      const arr = rowsByWs.get(r.working_sheet_id) ?? []
      arr.push({ description: r.description, unit: r.unit, qty: r.qty, rate: r.rate, amount: r.amount })
      rowsByWs.set(r.working_sheet_id, arr)
    }
  }

  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  const masterName = sheetName(project.code || 'Master', used)

  // Build each sub-skill's sheet first so the Master can link to its grand cell.
  const subMeta = new Map<string, { sheet: string; grandCell: string; total: number }>()
  for (const sub of subs) {
    const live = liveBySub.get(sub.id)
    if (!live) continue
    const rows = rowsByWs.get(live.id) ?? []
    const ws: Record<string, unknown> = {}
    ws['A1'] = S(`${sub.code} ${sub.name}`)
    ;['Sr', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'].forEach((h, i) => { ws[String.fromCharCode(65 + i) + '3'] = S(h) })
    let r = 4, sub_total = 0
    rows.forEach((row, i) => {
      const amt = Number(row.amount) || 0
      ws['A' + r] = N(i + 1)
      ws['B' + r] = S(row.description ?? '')
      ws['C' + r] = S(row.unit ?? '')
      if (row.qty != null) ws['D' + r] = N(Number(row.qty))
      if (row.rate != null) ws['E' + r] = N(Number(row.rate), MONEY)
      ws['F' + r] = N(amt, MONEY)
      sub_total += amt; r++
    })
    const grandRow = r + 1
    ws['E' + grandRow] = S('GRAND TOTAL')
    ws['F' + grandRow] = rows.length ? F(`SUM(F4:F${r - 1})`, sub_total, MONEY) : N(live.total, MONEY)
    ws['!ref'] = `A1:F${grandRow}`
    ws['!cols'] = [{ wch: 4 }, { wch: 40 }, { wch: 7 }, { wch: 10 }, { wch: 11 }, { wch: 14 }]
    const nm = sheetName(`${sub.code} ${sub.name}`, used)
    XLSX.utils.book_append_sheet(wb, ws as unknown as XLSX.WorkSheet, nm)
    subMeta.set(sub.id, { sheet: nm, grandCell: `F${grandRow}`, total: rows.length ? sub_total : live.total })
  }

  // Master summary sheet — Category → Sub Skill → Amount (linked) → Rs/sft.
  const m: Record<string, unknown> = {}
  m['A1'] = S(`INTERNAL ESTIMATE — MASTER · ${project.code} ${project.name}`)
  ;['Work Category', 'Sub Skill', 'Amount', ...(sft > 0 ? ['Rs / sft'] : [])].forEach((h, i) => { m[String.fromCharCode(65 + i) + '3'] = S(h) })
  let mr = 4
  const grandCells: string[] = []
  for (const d of discs) {
    const dSubs = subs.filter(s => s.discipline_id === d.id && subMeta.has(s.id))
    if (dSubs.length === 0) continue
    m['A' + mr] = S(`${d.code} ${d.name}`); mr++
    const catStart = mr
    for (const s of dSubs) {
      const meta = subMeta.get(s.id)!
      m['B' + mr] = S(`${s.code} ${s.name}`)
      m['C' + mr] = F(`'${meta.sheet}'!${meta.grandCell}`, meta.total, MONEY)   // LIVE LINK
      if (sft > 0) m['D' + mr] = F(`ROUND(C${mr}/${sft},0)`, Math.round(meta.total / sft), MONEY)
      mr++
    }
    // Category subtotal
    m['B' + mr] = S(`${d.code} subtotal`)
    m['C' + mr] = F(`SUM(C${catStart}:C${mr - 1})`, dSubs.reduce((a, s) => a + (subMeta.get(s.id)?.total ?? 0), 0), MONEY)
    grandCells.push(`C${mr}`)
    mr += 2
  }
  const grand = discs.flatMap(d => subs.filter(s => s.discipline_id === d.id && subMeta.has(s.id))).reduce((a, s) => a + (subMeta.get(s.id)?.total ?? 0), 0)
  m['B' + mr] = S('GRAND TOTAL')
  m['C' + mr] = grandCells.length ? F(grandCells.join('+'), grand, MONEY) : N(grand, MONEY)
  m['!ref'] = `A1:${sft > 0 ? 'D' : 'C'}${mr}`
  m['!cols'] = [{ wch: 26 }, { wch: 34 }, { wch: 16 }, ...(sft > 0 ? [{ wch: 10 }] : [])]
  m['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: sft > 0 ? 3 : 2 } }]

  // Master goes first.
  wb.SheetNames.unshift(masterName)
  wb.Sheets[masterName] = m as unknown as XLSX.WorkSheet

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const fname = `${(project.code || 'project').replace(/[^\w.-]+/g, '-')}_Internal-Estimate-Master.xlsx`
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  })
}
