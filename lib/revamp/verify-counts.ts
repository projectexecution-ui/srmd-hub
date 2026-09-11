// The yellow numbers on the ribbon: how many indents, work orders and purchase
// orders of THIS project are at Verify in IN4 right now — the approver's turn.
// One small live query per page load, cached within the request. Nothing is
// stored; IN4 is read only.
//
// Aksha, 10 Sep 2026: "when Verified in IN4 there should be a badge with the
// pending number so the approver knows."

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { unstable_cache } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { in4Query, in4Config } from '@/lib/in4/db'

/** A CT Hub project → the IN4 sub-projects linked to it (the two confirmed link tables, never a name match). */
export const subprojectIdsFor = cache(async (projectId: string): Promise<number[]> => {
  const supabase = await createClient()
  const { data: links } = await supabase.from('cc_bph_project_links').select('bph_project_id').eq('cc_project_id', projectId)
  const bphIds = (links ?? []).map(r => r.bph_project_id as string).filter(Boolean)
  if (bphIds.length === 0) return []
  const { data: subLinks } = await supabase.from('in4_subproject_links').select('subproject_id').in('bph_project_id', bphIds)
  return [...new Set((subLinks ?? []).map(r => r.subproject_id as number).filter(Number.isInteger))]
})

export interface VerifyCounts { indents: number; wos: number; pos: number }
const NONE: VerifyCounts = { indents: 0, wos: 0, pos: 0 }

// Tag for revalidating every verify count at once.
export const VERIFY_TAG = 'in4-verify'

/** Documents at Verify (113) or Amended & Verify (117) on these sub-projects.
 *  Zeros when IN4 is not there — a badge must never be a reason a page fails.
 *
 *  Cached for a minute ACROSS requests, not just within one. react's cache()
 *  alone deduped this inside a single render but left every project page load
 *  paying a fresh IN4 round trip — measured at 0.5-1.7s, average 907ms, and it
 *  blocks the layout because the ribbon needs it. A badge that is up to a
 *  minute stale is fine; a second on every click is not. Keyed by the
 *  sub-project list, so two projects never share an entry. */
const cachedVerifyCounts = unstable_cache(
  async (list: string): Promise<VerifyCounts> => {
    try {
      const [row] = await in4Query<Record<string, unknown>>(`
        SELECT
          (SELECT COUNT(*) FROM PURCH_INDENT i WHERE i.STATUS IN (113, 117) AND i.SUBPROJECT_ID IN (${list})) indents,
          (SELECT COUNT(*) FROM ENGG_WORK_ORDER w WHERE w.STATUS IN (113, 117) AND w.SUBPROJECT_ID IN (${list})) wos,
          (SELECT COUNT(*) FROM PURCH_PURCHASE_ORDER p WHERE p.STATUS IN (113, 117) AND p.SUBPROJECT_ID IN (${list})) pos`)
      return { indents: Number(row?.indents ?? 0), wos: Number(row?.wos ?? 0), pos: Number(row?.pos ?? 0) }
    } catch {
      return NONE
    }
  },
  ['in4-verify-project'],
  { tags: [VERIFY_TAG], revalidate: 60 },
)

export const loadVerifyCounts = cache(async (subprojectIds: readonly number[]): Promise<VerifyCounts> => {
  const ids = subprojectIds.filter(Number.isInteger)
  if (!in4Config() || ids.length === 0) return NONE
  // Sorted, so the same set of sub-projects is one cache entry however it
  // arrives ordered.
  return cachedVerifyCounts([...ids].sort((a, b) => a - b).join(','))
})

/** The ribbon's badge map and the words under each. Pure. */
export function verifyBadges(c: VerifyCounts): { badges: Record<string, number>; titles: Record<string, string> } {
  const badges: Record<string, number> = {}
  const titles: Record<string, string> = {}
  if (c.indents > 0) { badges['procurement'] = c.indents; titles['procurement'] = `${c.indents} indent${c.indents === 1 ? '' : 's'} at Verify in IN4 — waiting for the Atm Head` }
  const orders = c.wos + c.pos
  if (orders > 0) {
    badges['wo-po'] = orders
    titles['wo-po'] = [c.wos ? `${c.wos} WO${c.wos === 1 ? '' : 's'}` : null, c.pos ? `${c.pos} PO${c.pos === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ') + ' at Verify in IN4 — waiting for the Atm Head'
  }
  return { badges, titles }
}

// ── The same numbers for the whole portfolio ──────────────────────────
//
// The ribbon asks per project, on a project page. The sidebar and the home
// page need every project at once, and they render on EVERY page load — so
// this is one IN4 query for the whole app, cached for a minute rather than one
// query per project per request. The counts are facts about documents, the
// same for everyone, so the cache is global; who may SEE a given project is
// decided by the caller, which only ever renders projects already in that
// person's own tree.


// The pill's look lives in verify-pill.ts so client components can use it
// without dragging mssql into the browser bundle. Re-exported here so server
// callers have one place to look.
export { VERIFY_PILL } from './verify-pill'

export interface VerifyPortfolio {
  /** CT Hub project id → what is at Verify on the IN4 sub-projects linked to it. */
  byProject: Record<string, VerifyCounts>
  /** At Verify in IN4 but attached to no sub-project, or to one no CT Hub
   *  project is linked to. Real work that no project badge can ever show, so
   *  the home page says so rather than letting it fall down the gap. */
  unassigned: VerifyCounts
  total: VerifyCounts
}

const EMPTY_PORTFOLIO: VerifyPortfolio = { byProject: {}, unassigned: NONE, total: NONE }

function addTo(c: VerifyCounts, kind: string, n: number): VerifyCounts {
  if (kind === 'indent') return { ...c, indents: c.indents + n }
  if (kind === 'wo') return { ...c, wos: c.wos + n }
  return { ...c, pos: c.pos + n }
}

async function fetchVerifyPortfolio(): Promise<VerifyPortfolio> {
  if (!in4Config()) return EMPTY_PORTFOLIO

  // Sub-project → CT Hub project, through the two confirmed link tables.
  // Service role because the cached value is shared by everyone; the caller
  // filters to the projects the reader is allowed to see.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return EMPTY_PORTFOLIO
  const sb = createServiceClient(url, key, { auth: { persistSession: false } })

  const [{ data: projLinks }, { data: subLinks }] = await Promise.all([
    sb.from('cc_bph_project_links').select('bph_project_id, cc_project_id'),
    sb.from('in4_subproject_links').select('subproject_id, bph_project_id'),
  ])
  const ccByBph = new Map<string, string>()
  for (const r of projLinks ?? []) {
    if (r.bph_project_id && r.cc_project_id) ccByBph.set(r.bph_project_id as string, r.cc_project_id as string)
  }
  const ccBySub = new Map<number, string>()
  for (const r of subLinks ?? []) {
    const cc = ccByBph.get(r.bph_project_id as string)
    if (cc && Number.isInteger(r.subproject_id)) ccBySub.set(r.subproject_id as number, cc)
  }

  try {
    // Grouped, not filtered by a project list: one pass over the three tables
    // for the entire portfolio. A NULL sub-project is kept, not dropped — on
    // 11 Sep 2026 one of the three documents at Verify had none, and a filtered
    // query would have hidden it from every screen in the app.
    const rows = await in4Query<{ sub: number | null; kind: string; n: number }>(`
      SELECT SUBPROJECT_ID sub, 'indent' kind, COUNT(*) n FROM PURCH_INDENT
        WHERE STATUS IN (113, 117) GROUP BY SUBPROJECT_ID
      UNION ALL
      SELECT SUBPROJECT_ID, 'wo', COUNT(*) FROM ENGG_WORK_ORDER
        WHERE STATUS IN (113, 117) GROUP BY SUBPROJECT_ID
      UNION ALL
      SELECT SUBPROJECT_ID, 'po', COUNT(*) FROM PURCH_PURCHASE_ORDER
        WHERE STATUS IN (113, 117) GROUP BY SUBPROJECT_ID`)

    const byProject: Record<string, VerifyCounts> = {}
    let unassigned = NONE
    let total = NONE
    for (const r of rows) {
      const n = Number(r.n ?? 0)
      if (n <= 0) continue
      total = addTo(total, r.kind, n)
      const cc = Number.isInteger(r.sub) ? ccBySub.get(r.sub as number) : undefined
      if (!cc) { unassigned = addTo(unassigned, r.kind, n); continue }
      byProject[cc] = addTo(byProject[cc] ?? NONE, r.kind, n)
    }
    return { byProject, unassigned, total }
  } catch {
    // A badge must never be the reason a page fails.
    return EMPTY_PORTFOLIO
  }
}

/** Cached for a minute: a badge that is 60 seconds stale is fine, an IN4 round
 *  trip on every page load in the app is not. */
export const loadVerifyPortfolio = unstable_cache(
  fetchVerifyPortfolio,
  ['in4-verify-portfolio'],
  { tags: [VERIFY_TAG], revalidate: 60 },
)

/** Everything at Verify on one project, as a single number for a pill. */
export function verifyTotal(c: VerifyCounts | undefined): number {
  return c ? c.indents + c.wos + c.pos : 0
}

/** "1 indent and 2 POs at Verify in IN4" — the words under a pill. */
export function verifyWords(c: VerifyCounts): string {
  const parts = [
    c.indents ? `${c.indents} indent${c.indents === 1 ? '' : 's'}` : null,
    c.wos ? `${c.wos} work order${c.wos === 1 ? '' : 's'}` : null,
    c.pos ? `${c.pos} purchase order${c.pos === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  if (parts.length === 0) return 'Nothing at Verify in IN4'
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${list} at Verify in IN4`
}
