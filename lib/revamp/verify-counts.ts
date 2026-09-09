// The yellow numbers on the ribbon: how many indents, work orders and purchase
// orders of THIS project are at Verify in IN4 right now — the approver's turn.
// One small live query per page load, cached within the request. Nothing is
// stored; IN4 is read only.
//
// Aksha, 10 Sep 2026: "when Verified in IN4 there should be a badge with the
// pending number so the approver knows."

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
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

/** Documents at Verify (113) or Amended & Verify (117) on these sub-projects. Zeros when IN4 is not there — a badge must never be a reason a page fails. */
export const loadVerifyCounts = cache(async (subprojectIds: readonly number[]): Promise<VerifyCounts> => {
  const ids = subprojectIds.filter(Number.isInteger)
  if (!in4Config() || ids.length === 0) return NONE
  const list = ids.join(',')
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
