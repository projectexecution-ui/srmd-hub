// Maps a parsed Internal Budget (from parseInternalBudget) into the
// Working-Sheet rows to (re-)create for a project. Pure — no DB — so it is
// unit-testable and shared by the revision re-import route.
import type { InternalBudget } from './internal-budget-parse'

export interface WSPlanRow {
  subCode: string            // master sub-skill code, or a "<disc>99" bucket
  discCode: string           // 2-digit discipline code
  name: string
  amount: number
  remark: string | null
  mode: 'thumbrule' | 'excel_summary'
  lines: Array<{ description: string; unit: string | null; qty: number | null; rate: number | null; amount: number | null }>
}

export interface WSPlan {
  rows: WSPlanRow[]
  bucketDiscs: string[]      // disciplines needing an "Others — Budget Import" sub-skill
  unplaced: Array<{ name: string; amount: number }>
  total: number
}

// Discipline code → name, for matching prose section headings that carry no
// code (kept in sync with cc_disciplines; extra names map harmlessly).
const DISC_NAMES: Record<string, string> = {
  '01': 'Site Pre-lims', '02': 'Earthworks - Building', '03': 'Civil',
  '04': 'External Facade Works', '05': 'Waterproofing Works', '06': 'Mechanical Works',
  '07': 'Electrical Works', '08': 'Plumbing Works', '09': 'Fire Fighting Works',
  '10': 'MGPS', '11': 'ICT', '12': 'Finishes', '13': 'Interiors',
  '14': 'Signages & Artefacts', '15': 'Landscape', '16': 'Infra Works',
  '17': 'Site Cleaning Etc', '18': 'Consultants Cost', '19': 'Site Admin',
  '20': 'Extra Works', '21': 'Locals Handling Cost', '22': 'Contingencies',
  '23': 'Equipment Cost', '24': 'Land Cost', '25': 'Delay In Drawings, Contractor Idle Charges',
  '26': 'STP & ETP', '27': 'Earthwork - Road', '28': 'Temporary Acess Road',
  '29': 'Site Retaining Wall', '35': 'Kitchen',
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const bucketCode = (disc: string) => String(parseInt(disc, 10)) + '99'

/**
 * @param masterSubDisc  every master sub-skill code → its discipline code
 * @param masterDiscs    every valid discipline code
 */
export function mapBudgetToWS(
  b: InternalBudget,
  masterSubDisc: Map<string, string>,
  masterDiscs: Set<string>,
): WSPlan {
  const rows: WSPlanRow[] = []
  const bucketDiscs = new Set<string>()
  const unplaced: WSPlan['unplaced'] = []
  const byTarget = new Map<string, WSPlanRow>()
  let total = 0

  const discByName = new Map<string, string>()
  for (const [code, name] of Object.entries(DISC_NAMES)) discByName.set(norm(name), code)

  for (const d of b.disciplines) {
    // Resolve the section's discipline code.
    let disc: string | null = d.code && masterDiscs.has(d.code) ? d.code : null
    if (!disc) disc = discByName.get(norm(d.name)) ?? null
    if (!disc) {
      const m = d.name.match(/^(\d{2})(?:\.\d+)?\s/)
      if (m && masterDiscs.has(m[1])) disc = m[1]
    }
    for (const s of d.subSkills) {
      if (!(s.amount > 0)) continue
      let target: string | null = null
      let tDisc: string | null = null
      if (s.code && masterSubDisc.has(s.code)) { target = s.code; tDisc = masterSubDisc.get(s.code)! }
      else if (disc) { target = bucketCode(disc); tDisc = disc; bucketDiscs.add(disc) }
      if (!target || !tDisc) { unplaced.push({ name: s.name, amount: s.amount }); continue }

      total += s.amount
      const existing = byTarget.get(target)
      const line = { description: s.name, unit: null as string | null, qty: null as number | null, rate: null as number | null, amount: s.amount }
      const workingLines = (s.working ?? []).map(w => ({
        description: w.description ?? '', unit: w.unit, qty: w.qty, rate: w.rate, amount: w.amount,
      }))
      if (existing) {
        existing.amount += s.amount
        existing.lines.push(...(workingLines.length ? workingLines : [line]))
        existing.mode = 'excel_summary'
        if (s.remark && !existing.remark) existing.remark = s.remark
      } else {
        const row: WSPlanRow = {
          subCode: target, discCode: tDisc, name: s.name, amount: s.amount,
          remark: s.remark ?? null,
          mode: workingLines.length ? 'excel_summary' : 'thumbrule',
          lines: workingLines.length ? workingLines : [],
        }
        rows.push(row)
        byTarget.set(target, row)
      }
    }
  }
  // Grouped bucket rows: expose their component lines so reviewers see them.
  for (const row of rows) {
    if (row.subCode.endsWith('99') && row.lines.length === 0) row.mode = 'thumbrule'
    if (row.lines.length > 1 || row.subCode.endsWith('99')) row.mode = row.lines.length ? 'excel_summary' : row.mode
  }
  return { rows, bucketDiscs: [...bucketDiscs], unplaced, total }
}
