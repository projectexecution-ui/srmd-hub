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
import { computeMoneyRollup, subFigures, type RollupWSRow, type RollupVersionRow, type RollupBudgetLine } from '@/lib/cost-control/project-rollup'

export const dynamic = 'force-dynamic'

const MONEY = '#,##0'
const MONEY_DASH = '#,##0;-#,##0;"—"'   // zero renders as an em-dash, like the screen
const PCT = '0%'
const S = (v: string) => ({ t: 's', v })
const N = (v: number, z?: string) => ({ t: 'n', v, ...(z ? { z } : {}) })
const F = (f: string, v: number, z?: string) => ({ t: 'n', v, f, ...(z ? { z } : {}) })

function sheetName(base: string, used: Set<string>): string {
  let n = base.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let i = 2
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = n.slice(0, 31 - suf.length) + suf }
  used.add(n.toLowerCase())
  return n
}

interface Row { description: string | null; unit: string | null; qty: number | null; rate: number | null; amount: number | null }
interface Bucket { wsId: string; wsCode: string; status: string; total: number; versionNo: number; lineType: string | null }

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

  // Latest LIVE working sheet per (sub-skill, line_type) BUCKET, split into the
  // Internal Estimate baseline (the "[IB]" imports — the workings management
  // maintains, like the V8 master) and engineers' asks. A sub-skill can have
  // several buckets (work / material), each its own chain.
  const { data: wsAll } = await supabase
    .from('cc_ws_with_versions')
    .select('id, ws_code, sub_skill_id, line_type, version_no, status, total_amount, summary_notes, archived_at')
    .eq('project_id', projectId)
  const ibBySub = new Map<string, Bucket[]>()   // internal-estimate workings
  const engBySub = new Map<string, Bucket[]>()  // engineers' asks
  const latestByKey = new Map<string, number>()
  for (const w of (wsAll ?? [])) {
    if (!w.sub_skill_id) continue
    if (w.status === 'cancelled' || w.archived_at) continue
    const isIb = (w.summary_notes ?? '').startsWith('[IB')
    const map = isIb ? ibBySub : engBySub
    const key = `${isIb ? 'ib' : 'eng'}::${w.sub_skill_id}::${w.line_type ?? ''}`
    const v = w.version_no ?? 0
    const seen = latestByKey.get(key)
    if (seen != null && v <= seen) continue
    latestByKey.set(key, v)
    const arr = map.get(w.sub_skill_id) ?? []
    const existing = arr.findIndex(b => b.lineType === (w.line_type ?? null))
    const bucket: Bucket = { wsId: w.id, wsCode: w.ws_code, status: w.status, total: Number(w.total_amount) || 0, versionNo: v, lineType: w.line_type ?? null }
    if (existing >= 0) arr[existing] = bucket; else arr.push(bucket)
    map.set(w.sub_skill_id, arr)
  }

  const allWsIds = [...ibBySub.values(), ...engBySub.values()].flat().map(b => b.wsId)
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

  // Per-sub-skill / per-category MONEY rollup — the SAME computation the
  // project home page uses (lib/cost-control/project-rollup.ts), so every
  // figure in this workbook matches the screen exactly. Needs the raw working
  // sheets (with discipline + approved amounts), the version chain, and the
  // budget lines — fetched with the same filters as the page.
  const [{ data: wsFull }, { data: verRows }, { data: blRows }] = await Promise.all([
    supabase.from('cc_working_sheets')
      .select('id, discipline_id, sub_skill_id, status, total_amount, approved_for_erp_amt, summary_notes, entry_mode')
      .eq('project_id', projectId).is('archived_at', null),
    supabase.from('cc_ws_with_versions')
      .select('id, chain_anchor_id, version_no')
      .eq('project_id', projectId).is('archived_at', null),
    supabase.from('cc_budget_lines')
      .select('discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', projectId),
  ])
  const rollup = computeMoneyRollup({
    wsRows: (wsFull ?? []) as RollupWSRow[],
    versionRows: (verRows ?? []) as RollupVersionRow[],
    budgetLines: (blRows ?? []) as RollupBudgetLine[],
    subSkills: subs.map(s => ({ id: s.id, discipline_id: s.discipline_id })),
    disciplines: discs.map(d => ({ id: d.id })),
  })

  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  const masterName = sheetName(project.code || 'Master', used)

  // A sub-sheet per bucket; its GRAND = the WS total_amount (GST-inclusive), with
  // a reconciling "GST / additions" line when total ≠ Σ rows. Returns the grand
  // cell so the Master can link to it.
  function buildBucketSheet(label: string, b: Bucket): { name: string; grandRef: string } {
    const rows = rowsByWs.get(b.wsId) ?? []
    const ws: Record<string, unknown> = {}
    ws['A1'] = S(label)
    ws['A2'] = S(`Version ${b.versionNo} · ${b.wsCode}${b.status ? ' · ' + b.status.replace(/_/g, ' ') : ''}`)
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
    return { name: nm, grandRef: `'${nm}'!F${grandRow}` }
  }

  // Per sub-skill: build the BOQ drill-down tab(s) for BOTH the internal-estimate
  // working ([IB]) and the engineer's ask, and remember the version label, the
  // internal-estimate grand cell refs (so the summary's Internal Estimate cell
  // is a LIVE cross-sheet link to those working sheets, like the V8 master), the
  // tab to open from the sub-skill name, and the ask tab to open from Awaiting.
  interface SubMeta { versionLabel: string; nameLink: string; ieRefs: string[]; engLink: string }
  const subMeta = new Map<string, SubMeta>()
  const vlabel = (b: Bucket, many: boolean) => many ? `v${b.versionNo} (${b.lineType ?? 'work'})` : `v${b.versionNo}`
  for (const sub of subs) {
    const ib = ibBySub.get(sub.id) ?? []
    const eng = engBySub.get(sub.id) ?? []
    if (ib.length === 0 && eng.length === 0) continue
    const ieRefs: string[] = []
    let nameLink = '', engLink = ''
    for (const b of ib) {
      const label = ib.length > 1 ? `${sub.code} ${sub.name} (${b.lineType ?? 'work'})` : `${sub.code} ${sub.name}`
      const { name, grandRef } = buildBucketSheet(label, b)
      ieRefs.push(grandRef)
      if (!nameLink) nameLink = name
    }
    for (const b of eng) {
      const label = `${sub.code} ${sub.name} — ask${eng.length > 1 ? ` (${b.lineType ?? 'work'})` : ''}`
      const { name } = buildBucketSheet(label, b)
      if (!engLink) engLink = name
      if (!nameLink) nameLink = name
    }
    const versionLabel = (ib.length ? ib.map(b => vlabel(b, ib.length > 1)) : eng.map(b => vlabel(b, eng.length > 1))).join(' · ')
    subMeta.set(sub.id, { versionLabel, nameLink, ieRefs, engLink })
  }

  // Master summary — EVERY enabled category and sub-skill with the SAME
  // columns management sees on the project home page (Internal Estimate,
  // Awaiting Approval, Budget ERP, WO/PO, Paid, % Used, Working Sheets),
  // category subtotals + a grand total, ₹/sft, and collapsible
  // category→sub-skill grouping (Excel row outline). Numbers come from the
  // shared rollup, so this workbook always matches the screen.
  const m: Record<string, unknown> = {}
  const hasSft = sft > 0
  // Column letters: A Category · B Sub-skill · C Version · D Internal Estimate ·
  // E Awaiting Approval · F Budget (ERP) · G WO/PO · H Paid · I % Used ·
  // J Working Sheets · K Rs/sft
  const IE = 'D', AWAIT = 'E', BUD = 'F', WO = 'G', PAID = 'H', PCTU = 'I', WSN = 'J', SFT = 'K'
  const lastCol = hasSft ? 'K' : 'J'
  m['A1'] = S(`INTERNAL ESTIMATE — MASTER · ${project.code} ${project.name}`)
  const cols = ['Work Category', 'Sub Skill', 'Version', 'Internal Estimate', 'Awaiting Approval',
    'Budget (ERP)', 'WO / PO', 'Paid', '% Used', 'Working Sheets', ...(hasSft ? ['Rs / sft'] : [])]
  cols.forEach((h, i) => { m[String.fromCharCode(65 + i) + '3'] = S(h) })
  const rowLevels: Array<{ level?: number }> = []
  const setLevel = (r1: number, level: number) => { rowLevels[r1 - 1] = level ? { level } : {} }
  // % Used cell = paid/budget for that row (blank when no budget). Working
  // Sheets subtotal/grand = SUM of the child counts. Money subtotals SUM the
  // child cells (text "—"/zero cells are ignored by SUM).
  const pctCell = (r: number, paidVal: number, budVal: number) =>
    F(`IF(${BUD}${r}>0,${PAID}${r}/${BUD}${r},"")`, budVal > 0 ? paidVal / budVal : 0, PCT)
  let mr = 4
  const catRows: number[] = []
  let gIE = 0, gAwait = 0, gBud = 0, gWo = 0, gPaid = 0, gWs = 0
  for (const d of discs) {
    const dSubs = subs.filter(s => s.discipline_id === d.id).sort((a, b) => a.code.localeCompare(b.code))
    if (dSubs.length === 0) continue
    m['A' + mr] = S(`${d.code} ${d.name}`); setLevel(mr, 0); mr++    // category header
    const catStart = mr
    const cat: Record<string, number> = { [IE]: 0, [AWAIT]: 0, [BUD]: 0, [WO]: 0, [PAID]: 0, [WSN]: 0 }
    for (const s of dSubs) {
      m['B' + mr] = S(`${s.code} ${s.name}`)
      const meta = subMeta.get(s.id)
      if (meta) {
        m['C' + mr] = S(meta.versionLabel)
        // Hyperlink the sub-skill name to its working sheet tab.
        if (meta.nameLink) (m['B' + mr] as { l?: unknown }).l = { Target: `#'${meta.nameLink}'!A1`, Tooltip: 'Open working sheet' }
      }
      const f = subFigures(rollup, d.id, s.id)
      // Internal Estimate — LIVE cross-sheet link to the sub-skill's working
      // sheet grand(s), so the workbook stays internally connected (V8 master).
      m[IE + mr] = (meta && meta.ieRefs.length)
        ? F(meta.ieRefs.join('+'), f.internalEstimate, MONEY_DASH)
        : N(f.internalEstimate, MONEY_DASH)
      m[AWAIT + mr] = N(f.awaitingApproval, MONEY_DASH)
      // Drill into the engineer's ask sheet from the Awaiting cell.
      if (meta?.engLink) (m[AWAIT + mr] as { l?: unknown }).l = { Target: `#'${meta.engLink}'!A1`, Tooltip: 'Open the engineer working sheet' }
      m[BUD + mr] = N(f.budget, MONEY_DASH)
      m[WO + mr] = N(f.wo, MONEY_DASH)
      m[PAID + mr] = N(f.paid, MONEY_DASH)
      m[PCTU + mr] = pctCell(mr, f.paid, f.budget)
      m[WSN + mr] = N(f.wsCount, MONEY_DASH)
      if (hasSft) m[SFT + mr] = F(`IF(${IE}${mr}=0,"",ROUND(${IE}${mr}/${sft},0))`, f.internalEstimate ? Math.round(f.internalEstimate / sft) : 0, MONEY_DASH)
      cat[IE] += f.internalEstimate; cat[AWAIT] += f.awaitingApproval; cat[BUD] += f.budget
      cat[WO] += f.wo; cat[PAID] += f.paid; cat[WSN] += f.wsCount
      gIE += f.internalEstimate; gAwait += f.awaitingApproval; gBud += f.budget
      gWo += f.wo; gPaid += f.paid; gWs += f.wsCount
      setLevel(mr, 1)   // sub-skill detail → collapsible under its category
      mr++
    }
    // Category subtotal row (the group summary — sits below its detail).
    m['B' + mr] = S(`${d.code} subtotal`)
    for (const col of [IE, AWAIT, BUD, WO, PAID, WSN]) {
      m[col + mr] = F(`SUM(${col}${catStart}:${col}${mr - 1})`, cat[col], MONEY_DASH)
    }
    m[PCTU + mr] = pctCell(mr, cat[PAID], cat[BUD])
    if (hasSft) m[SFT + mr] = F(`IF(${IE}${mr}=0,"",ROUND(${IE}${mr}/${sft},0))`, cat[IE] ? Math.round(cat[IE] / sft) : 0, MONEY_DASH)
    catRows.push(mr)
    setLevel(mr, 0)
    mr += 2
  }
  // GRAND TOTAL — sum the category subtotal rows.
  m['B' + mr] = S('GRAND TOTAL')
  const gVals: Record<string, number> = { [IE]: gIE, [AWAIT]: gAwait, [BUD]: gBud, [WO]: gWo, [PAID]: gPaid, [WSN]: gWs }
  for (const col of [IE, AWAIT, BUD, WO, PAID, WSN]) {
    m[col + mr] = catRows.length
      ? F(catRows.map(r => `${col}${r}`).join('+'), gVals[col], MONEY_DASH)
      : N(gVals[col], MONEY_DASH)
  }
  m[PCTU + mr] = pctCell(mr, gPaid, gBud)
  if (hasSft) m[SFT + mr] = F(`IF(${IE}${mr}=0,"",ROUND(${IE}${mr}/${sft},0))`, gIE ? Math.round(gIE / sft) : 0, MONEY_DASH)
  m['!ref'] = `A1:${lastCol}${mr}`
  m['!cols'] = [{ wch: 24 }, { wch: 34 }, { wch: 13 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 11 }, ...(hasSft ? [{ wch: 9 }] : [])]
  m['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: hasSft ? 10 : 9 } }]
  m['!rows'] = rowLevels
  m['!outline'] = { above: false }   // subtotal (summary) sits below its detail

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
