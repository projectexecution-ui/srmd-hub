// Master Excel export — the single linked workbook management is used to (mirrors
// the V8 NGH_B master): a "Master" summary listing EVERY Work Category and
// Sub-skill (whether or not it has a sheet yet), each amount a live cross-sheet
// formula to that sub-skill's grand total (GST-inclusive), category subtotals,
// grand total, ₹/sft; plus one working sheet per sub-skill/bucket, internally
// linked. Management-only. Read-only; not behind the experimental flag.

import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'

export const dynamic = 'force-dynamic'

const MONEY = '#,##0'
const S = (v: string) => ({ t: 's', v })
const N = (v: number, z?: string) => ({ t: 'n', v, ...(z ? { z } : {}) })
const F = (f: string, v: number, z?: string) => ({ t: 'n', v, f, ...(z ? { z } : {}) })
const APPROVED = new Set(['approved', 'partially_approved', 'wo_issued', 'paid'])

function sheetName(base: string, used: Set<string>): string {
  let n = base.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let i = 2
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = n.slice(0, 31 - suf.length) + suf }
  used.add(n.toLowerCase())
  return n
}

interface Row { description: string | null; unit: string | null; qty: number | null; rate: number | null; amount: number | null }
interface Bucket { wsId: string; total: number; versionNo: number; lineType: string | null }

export async function GET(req: NextRequest) {
  await requirePermission('cost-control', 'view')
  if (!(await checkIsCcReviewer())) return new Response('Management only', { status: 403 })
  const projectId = req.nextUrl.searchParams.get('project')
  if (!projectId) return new Response('project required', { status: 400 })

  const supabase = await createClient()
  const { data: project } = await supabase.from('projects').select('code, name, built_up_sft').eq('id', projectId).maybeSingle()
  if (!project) return new Response('project not found', { status: 404 })
  const sft = Number(project.built_up_sft) || 0

  const [{ data: pd }, { data: ps }] = await Promise.all([
    supabase.from('cc_project_disciplines').select('cc_disciplines(id, code, name, display_order)').eq('project_id', projectId).eq('is_enabled', true),
    supabase.from('cc_project_sub_skills').select('cc_sub_skills(id, discipline_id, code, name)').eq('project_id', projectId).eq('is_enabled', true),
  ])
  type D = { id: string; code: string; name: string; display_order: number }
  type SS = { id: string; discipline_id: string; code: string; name: string }
  const discs: D[] = (pd ?? []).map(r => (Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines)).filter(Boolean) as D[]
  const subs: SS[] = (ps ?? []).map(r => (Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills)).filter(Boolean) as SS[]
  discs.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.code.localeCompare(b.code))

  // Latest LIVE working sheet per (sub-skill, line_type) BUCKET — a sub-skill
  // can have several buckets (work / material), each its own chain.
  const { data: wsAll } = await supabase
    .from('cc_ws_with_versions')
    .select('id, sub_skill_id, line_type, version_no, status, total_amount, summary_notes, archived_at')
    .eq('project_id', projectId)
  const bucketsBySub = new Map<string, Bucket[]>()
  const latestByKey = new Map<string, { versionNo: number }>()
  for (const w of (wsAll ?? [])) {
    if (!w.sub_skill_id) continue
    if ((w.summary_notes ?? '').startsWith('[IB')) continue
    if (w.status === 'cancelled' || w.archived_at) continue
    const key = `${w.sub_skill_id}::${w.line_type ?? ''}`
    const v = w.version_no ?? 0
    const seen = latestByKey.get(key)
    if (seen && v <= seen.versionNo) continue
    latestByKey.set(key, { versionNo: v })
    const arr = bucketsBySub.get(w.sub_skill_id) ?? []
    const existing = arr.findIndex(b => b.lineType === (w.line_type ?? null))
    const bucket: Bucket = { wsId: w.id, total: Number(w.total_amount) || 0, versionNo: v, lineType: w.line_type ?? null }
    if (existing >= 0) arr[existing] = bucket; else arr.push(bucket)
    bucketsBySub.set(w.sub_skill_id, arr)
  }

  const allWsIds = [...bucketsBySub.values()].flat().map(b => b.wsId)
  const rowsByWs = new Map<string, Row[]>()
  if (allWsIds.length) {
    const { data: rows } = await supabase
      .from('cc_excel_rows')
      .select('working_sheet_id, row_no, description, unit, qty, rate, amount')
      .in('working_sheet_id', allWsIds).order('row_no')
    for (const r of (rows ?? [])) {
      const arr = rowsByWs.get(r.working_sheet_id) ?? []
      arr.push({ description: r.description, unit: r.unit, qty: r.qty, rate: r.rate, amount: r.amount })
      rowsByWs.set(r.working_sheet_id, arr)
    }
  }

  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  const masterName = sheetName(project.code || 'Master', used)

  // A sub-sheet per bucket; its GRAND = the WS total_amount (GST-inclusive), with
  // a reconciling "GST / additions" line when total ≠ Σ rows. Returns the grand
  // cell so the Master can link to it.
  function buildBucketSheet(label: string, b: Bucket): string {
    const rows = rowsByWs.get(b.wsId) ?? []
    const ws: Record<string, unknown> = {}
    ws['A1'] = S(label)
    ;['Sr', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'].forEach((h, i) => { ws[String.fromCharCode(65 + i) + '3'] = S(h) })
    let r = 4, rowsum = 0
    rows.forEach((row, i) => {
      const amt = Number(row.amount) || 0
      ws['A' + r] = N(i + 1); ws['B' + r] = S(row.description ?? ''); ws['C' + r] = S(row.unit ?? '')
      if (row.qty != null) ws['D' + r] = N(Number(row.qty))
      if (row.rate != null) ws['E' + r] = N(Number(row.rate), MONEY)
      ws['F' + r] = N(amt, MONEY)
      rowsum += amt; r++
    })
    let grandRow: number
    if (rows.length === 0) {
      grandRow = 4
      ws['E' + grandRow] = S('GRAND TOTAL'); ws['F' + grandRow] = N(b.total, MONEY)
    } else {
      const subRow = r
      ws['E' + subRow] = S('Subtotal'); ws['F' + subRow] = F(`SUM(F4:F${r - 1})`, rowsum, MONEY)
      const gap = b.total - rowsum
      if (Math.abs(gap) > 1) {
        const addRow = r + 1
        ws['E' + addRow] = S('GST / additions'); ws['F' + addRow] = N(gap, MONEY)
        grandRow = r + 2
        ws['E' + grandRow] = S('GRAND TOTAL'); ws['F' + grandRow] = F(`F${subRow}+F${addRow}`, b.total, MONEY)
      } else {
        grandRow = r + 1
        ws['E' + grandRow] = S('GRAND TOTAL'); ws['F' + grandRow] = F(`F${subRow}`, b.total, MONEY)
      }
    }
    ws['!ref'] = `A1:F${grandRow}`
    ws['!cols'] = [{ wch: 4 }, { wch: 40 }, { wch: 7 }, { wch: 10 }, { wch: 11 }, { wch: 14 }]
    const nm = sheetName(label, used)
    XLSX.utils.book_append_sheet(wb, ws as unknown as XLSX.WorkSheet, nm)
    return `'${nm}'!F${grandRow}`
  }

  // Per sub-skill: link cell(s) to its bucket grand(s). Multi-bucket → sum them.
  const subLink = new Map<string, { formula: string; total: number }>()
  for (const sub of subs) {
    const buckets = bucketsBySub.get(sub.id)
    if (!buckets || buckets.length === 0) continue
    const refs: string[] = []
    let total = 0
    for (const b of buckets) {
      const label = buckets.length > 1 ? `${sub.code} ${sub.name} (${b.lineType ?? 'work'})` : `${sub.code} ${sub.name}`
      refs.push(buildBucketSheet(label, b))
      total += b.total
    }
    subLink.set(sub.id, { formula: refs.join('+'), total })
  }

  // Master summary — EVERY enabled category and sub-skill.
  const m: Record<string, unknown> = {}
  m['A1'] = S(`INTERNAL ESTIMATE — MASTER · ${project.code} ${project.name}`)
  const cols = ['Work Category', 'Sub Skill', 'Amount', ...(sft > 0 ? ['Rs / sft'] : [])]
  cols.forEach((h, i) => { m[String.fromCharCode(65 + i) + '3'] = S(h) })
  let mr = 4
  const catSubtotalCells: string[] = []
  let grand = 0
  for (const d of discs) {
    const dSubs = subs.filter(s => s.discipline_id === d.id).sort((a, b) => a.code.localeCompare(b.code))
    if (dSubs.length === 0) continue
    m['A' + mr] = S(`${d.code} ${d.name}`); mr++
    const catStart = mr
    let catHasAmount = false
    for (const s of dSubs) {
      m['B' + mr] = S(`${s.code} ${s.name}`)
      const link = subLink.get(s.id)
      if (link) {
        m['C' + mr] = F(link.formula, link.total, MONEY)
        if (sft > 0) m['D' + mr] = F(`IF(C${mr}="","",ROUND(C${mr}/${sft},0))`, Math.round(link.total / sft), MONEY)
        grand += link.total; catHasAmount = true
      } else {
        m['C' + mr] = S('—')  // enabled but no working sheet yet
      }
      mr++
    }
    m['B' + mr] = S(`${d.code} subtotal`)
    m['C' + mr] = catHasAmount ? F(`SUM(C${catStart}:C${mr - 1})`, dSubs.reduce((a, s) => a + (subLink.get(s.id)?.total ?? 0), 0), MONEY) : S('—')
    if (catHasAmount) catSubtotalCells.push(`C${mr}`)
    mr += 2
  }
  m['B' + mr] = S('GRAND TOTAL')
  m['C' + mr] = catSubtotalCells.length ? F(catSubtotalCells.join('+'), grand, MONEY) : N(grand, MONEY)
  if (sft > 0) m['D' + mr] = F(`ROUND(C${mr}/${sft},0)`, sft > 0 ? Math.round(grand / sft) : 0, MONEY)
  m['!ref'] = `A1:${sft > 0 ? 'D' : 'C'}${mr}`
  m['!cols'] = [{ wch: 26 }, { wch: 36 }, { wch: 16 }, ...(sft > 0 ? [{ wch: 10 }] : [])]
  m['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: sft > 0 ? 3 : 2 } }]

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
