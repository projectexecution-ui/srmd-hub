// The cumulative-versions math — pure, DB-free, fully unit-tested. Given a
// working sheet's version chain and its line items, it answers the two
// questions the Trustee actually asks on a revision:
//
//   1. Money:  how much have I ALREADY approved, what is THIS version asking,
//              and what is the CUMULATIVE after this? (chainCumulative)
//   2. Lines:  per BOQ item, what qty/rate did I approve before vs what is
//              being asked now — did a rate change (and which component), is
//              it a brand-new item, was an approved item dropped, and does it
//              look like a double claim? (matchBoqRows)
//
// [IB…] baseline sheets, cancelled versions and archived versions are excluded
// from every computation — they share a bucket but are not real asks.

export interface LedgerVersion {
  id: string
  version_no: number
  status: string                 // cc_ws_status text
  total_amount: number
  approved_for_erp_amt: number
  summary_notes: string | null
  archived_at: string | null
}

/** A version counts toward the cumulative math unless it's a baseline estimate,
 *  cancelled, or archived. */
export function isRealVersion(v: LedgerVersion): boolean {
  if ((v.summary_notes ?? '').startsWith('[IB')) return false
  if (v.status === 'cancelled') return false
  if (v.archived_at) return false
  return true
}

export interface CumulativeMoney {
  alreadyApproved: number   // Σ approved_for_erp_amt released by real PRIOR versions
  cumulative: number        // THIS version's full-BOQ total (a revision restates
                            //   the whole BOQ, cloned from the approved version)
  thisAsk: number           // cumulative − alreadyApproved (new money requested now)
  priorCount: number        // how many prior versions contributed
}

/** Money strip: already approved (prior releases) · this NEW ask · cumulative.
 *  A revision carries forward the full BOQ, so this version's total_amount IS
 *  the cumulative; the incremental ask is what's left after prior releases. */
export function chainCumulative(siblings: LedgerVersion[], currentId: string): CumulativeMoney {
  const current = siblings.find(v => v.id === currentId)
  const curVer = current?.version_no ?? Number.POSITIVE_INFINITY
  const priors = siblings.filter(v => isRealVersion(v) && v.version_no < curVer)
  const alreadyApproved = priors.reduce((s, v) => s + (Number(v.approved_for_erp_amt) || 0), 0)
  const cumulative = current ? (Number(current.total_amount) || 0) : 0
  return {
    alreadyApproved,
    cumulative,
    thisAsk: cumulative - alreadyApproved,
    priorCount: priors.length,
  }
}

// ── Per-line matching ──────────────────────────────────────────────────────

export type QtyBasis = 'measured' | 'estimated'

export interface BoqItem {
  description: string
  unit?: string | null
  qty: number
  rate: number
  amount: number
  material?: number | null
  installation?: number | null
  ml?: number | null
  /** Take-off basis (S10): measured = qty from a formula/link; estimated =
   *  plain number, no drawing. Undefined on legacy rows → treated as measured. */
  basis?: QtyBasis | null
}

/** Count measured vs estimate across a BOQ (for the Trustee confidence line).
 *  A missing basis is treated as measured (legacy, pre-take-off-capture). */
export function basisCounts(items: BoqItem[]): { measured: number; estimated: number; total: number } {
  let estimated = 0
  for (const it of items) if (it.basis === 'estimated') estimated++
  return { measured: items.length - estimated, estimated, total: items.length }
}

export type RateComponent = 'material' | 'installation' | 'ml' | 'rate'

export interface MatchedRow {
  key: string
  description: string
  unit: string | null
  // prior-approved side (null when brand new)
  approvedQty: number | null
  approvedRate: number | null
  approvedAmount: number | null
  // this-version side (null when dropped)
  newQty: number | null
  newRate: number | null
  newAmount: number | null
  // deltas + flags
  qtyDelta: number | null
  rateChanged: boolean
  rateOld: number | null
  rateNew: number | null
  rateChangeComponents: RateComponent[]
  isNew: boolean
  dropped: boolean
  possibleDoubleClaim: boolean
  // take-off basis (S10)
  approvedBasis: QtyBasis | null
  newBasis: QtyBasis | null
  basisPromoted: boolean   // estimated (prior) → measured (now)
}

/** Normalise a description into a match key: lowercase, strip punctuation,
 *  collapse whitespace. */
export function normalizeKey(desc: string): string {
  return (desc ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const EPS = 0.5 // rupee tolerance for "rate changed"

function tokens(s: string): Set<string> {
  return new Set(normalizeKey(s).split(' ').filter(t => t.length > 2))
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

interface Agg { qty: number; amount: number; rate: number; unit: string | null; material: number | null; installation: number | null; ml: number | null; desc: string; basis: QtyBasis }

function aggregate(items: BoqItem[]): Map<string, Agg> {
  const m = new Map<string, Agg>()
  for (const it of items) {
    const key = normalizeKey(it.description)
    if (!key) continue
    // A merged item is measured if ANY of its parts is measured (only fully
    // un-measured items read as estimate).
    const itBasis: QtyBasis = it.basis === 'estimated' ? 'estimated' : 'measured'
    const prev = m.get(key)
    if (prev) {
      prev.qty += Number(it.qty) || 0
      prev.amount += Number(it.amount) || 0
      prev.rate = prev.qty !== 0 ? prev.amount / prev.qty : (Number(it.rate) || prev.rate)
      if (itBasis === 'measured') prev.basis = 'measured'
    } else {
      m.set(key, {
        qty: Number(it.qty) || 0,
        amount: Number(it.amount) || 0,
        rate: Number(it.rate) || 0,
        unit: it.unit ?? null,
        material: it.material ?? null,
        installation: it.installation ?? null,
        ml: it.ml ?? null,
        desc: it.description,
        basis: itBasis,
      })
    }
  }
  return m
}

function changedComponents(a: Agg, b: Agg): RateComponent[] {
  const out: RateComponent[] = []
  const cmp = (x: number | null, y: number | null) =>
    Math.abs((x ?? 0) - (y ?? 0)) > EPS
  const haveParts = [a.material, a.installation, a.ml, b.material, b.installation, b.ml].some(v => v != null)
  if (haveParts) {
    if (cmp(a.material, b.material)) out.push('material')
    if (cmp(a.installation, b.installation)) out.push('installation')
    if (cmp(a.ml, b.ml)) out.push('ml')
  }
  if (out.length === 0 && Math.abs(a.rate - b.rate) > EPS) out.push('rate')
  return out
}

/** Match this version's items against everything approved so far. Returns
 *  continuing rows (in current order), then brand-new rows, then dropped
 *  approved rows — the exact order the cumulative table renders. */
export function matchBoqRows(current: BoqItem[], priorApproved: BoqItem[]): MatchedRow[] {
  const prior = aggregate(priorApproved)
  const cur = aggregate(current)
  const priorTokenList = [...prior.entries()].map(([k, v]) => ({ k, tok: tokens(v.desc) }))

  const continuing: MatchedRow[] = []
  const fresh: MatchedRow[] = []
  const usedPriorKeys = new Set<string>()

  for (const [key, c] of cur) {
    const p = prior.get(key)
    if (p) {
      usedPriorKeys.add(key)
      const comps = changedComponents(p, c)
      continuing.push({
        key, description: c.desc, unit: c.unit,
        approvedQty: p.qty, approvedRate: p.rate, approvedAmount: p.amount,
        newQty: c.qty, newRate: c.rate, newAmount: c.amount,
        qtyDelta: c.qty - p.qty,
        rateChanged: comps.length > 0,
        rateOld: p.rate, rateNew: c.rate,
        rateChangeComponents: comps,
        isNew: false, dropped: false, possibleDoubleClaim: false,
        approvedBasis: p.basis, newBasis: c.basis,
        basisPromoted: p.basis === 'estimated' && c.basis === 'measured',
      })
    } else {
      // Brand new. Advisory: does it strongly resemble an already-approved
      // item (engineer re-adding something already released)?
      const ctok = tokens(c.desc)
      const dbl = priorTokenList.some(p2 => !usedPriorKeys.has(p2.k) && jaccard(ctok, p2.tok) >= 0.6)
      fresh.push({
        key, description: c.desc, unit: c.unit,
        approvedQty: null, approvedRate: null, approvedAmount: null,
        newQty: c.qty, newRate: c.rate, newAmount: c.amount,
        qtyDelta: null,
        rateChanged: false, rateOld: null, rateNew: c.rate,
        rateChangeComponents: [],
        isNew: true, dropped: false, possibleDoubleClaim: dbl,
        approvedBasis: null, newBasis: c.basis, basisPromoted: false,
      })
    }
  }

  const dropped: MatchedRow[] = []
  for (const [key, p] of prior) {
    if (usedPriorKeys.has(key)) continue
    dropped.push({
      key, description: p.desc, unit: p.unit,
      approvedQty: p.qty, approvedRate: p.rate, approvedAmount: p.amount,
      newQty: null, newRate: null, newAmount: null,
      qtyDelta: null,
      rateChanged: false, rateOld: p.rate, rateNew: null,
      rateChangeComponents: [],
      isNew: false, dropped: true, possibleDoubleClaim: false,
      approvedBasis: p.basis, newBasis: null, basisPromoted: false,
    })
  }

  return [...continuing, ...fresh, ...dropped]
}

export interface MatchSummary {
  approvedTotal: number     // Σ prior-approved amounts across matched + dropped
  newAskTotal: number       // Σ this-version amounts across matched + new
  continuingCount: number
  newCount: number
  droppedCount: number
  rateChangedCount: number
  doubleClaimCount: number
  // take-off confidence across the CURRENT version's rows (S10)
  measuredCount: number
  estimateCount: number
  promotedCount: number     // estimated → measured this version
}

export function summarizeMatch(rows: MatchedRow[]): MatchSummary {
  const present = rows.filter(r => !r.dropped) // rows in the current version
  return {
    approvedTotal: rows.reduce((s, r) => s + (r.approvedAmount ?? 0), 0),
    newAskTotal: rows.reduce((s, r) => s + (r.newAmount ?? 0), 0),
    continuingCount: rows.filter(r => !r.isNew && !r.dropped).length,
    newCount: rows.filter(r => r.isNew).length,
    droppedCount: rows.filter(r => r.dropped).length,
    rateChangedCount: rows.filter(r => r.rateChanged).length,
    doubleClaimCount: rows.filter(r => r.possibleDoubleClaim).length,
    measuredCount: present.filter(r => r.newBasis !== 'estimated').length,
    estimateCount: present.filter(r => r.newBasis === 'estimated').length,
    promotedCount: rows.filter(r => r.basisPromoted).length,
  }
}
