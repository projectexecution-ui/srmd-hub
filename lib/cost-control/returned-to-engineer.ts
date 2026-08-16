import { createClient } from '@/lib/supabase/server'
import { getMyProfile, getMyPermissions, can } from '@/lib/auth'

/** Budgets an approver has sent back, still sitting with the engineer.
 *
 *  Deliberately NOT part of the approval inbox: these are not the approver's to
 *  act on, and mixing them in is exactly what made the dashboard untrustworthy.
 *  This is a chasing list — who is holding it, for how long, and what he was
 *  asked to change, so the loop can be closed without opening each sheet. */

/** Red after this many days with the engineer — same threshold the approval
 *  reminder uses for "stuck", so the two never disagree. */
export const RETURNED_STALE_DAYS = 3

export type ReturnedItem = {
  id: string
  wsCode: string | null
  projectCode: string | null
  projectName: string | null
  work: string
  amount: number
  engineer: string | null
  returnedBy: string | null
  returnedAt: string | null
  days: number
  comment: string | null
  url: string
}

export async function getReturnedToEngineer(): Promise<{ items: ReturnedItem[]; error?: string }> {
  const [profile, perms] = await Promise.all([getMyProfile(), getMyPermissions()])
  if (!can(perms, 'cost-control', 'view')) return { items: [] }

  const sb = await createClient()
  const { data, error } = await sb
    .from('cc_working_sheets')
    .select(`id, ws_code, project_id, total_amount, summary_total,
             projects(code, name),
             cc_sub_skills(name), cc_disciplines(name),
             eng:profiles!cc_working_sheets_engineer_id_fkey(full_name, name)`)
    .eq('status', 'returned')
    .is('archived_at', null)
  if (error) return { items: [], error: error.message }

  const rows = data ?? []
  if (rows.length === 0) return { items: [] }

  // When it was returned, and why — the return comment is the whole point of
  // this list, otherwise chasing means opening every sheet to remember.
  const { data: events } = await sb
    .from('approval_events')
    .select('doc_id, created_at, comment, actor_id, profiles(full_name, name)')
    .eq('doc_table', 'cc_working_sheets')
    .eq('to_stage', 'returned')
    .in('doc_id', rows.map(r => r.id))
    .order('created_at', { ascending: false })

  const latest = new Map<string, { at: string; comment: string | null; by: string | null }>()
  for (const e of events ?? []) {
    if (latest.has(e.doc_id)) continue           // ordered desc, so first wins
    const who = one(e.profiles)
    latest.set(e.doc_id, {
      at: e.created_at,
      comment: e.comment,
      by: who?.full_name ?? who?.name ?? null,
    })
  }

  // A head sees only the projects he approves for; an admin sees everything.
  let allowed: Set<string> | null = null
  if (!can(perms, 'cost-control', 'admin') && profile?.role !== 'admin') {
    const { data: mine } = await sb
      .from('cc_project_approvers')
      .select('project_id')
      .eq('user_id', profile?.id ?? '')
    // No assignments at all → don't silently show nothing; show everything, the
    // same fallback the approval rules use.
    if (mine && mine.length > 0) allowed = new Set(mine.map(m => m.project_id))
  }

  const today = Date.now()
  const items = rows
    .filter(r => !allowed || allowed.has(r.project_id))
    .map<ReturnedItem>(r => {
      const ev = latest.get(r.id)
      const proj = one(r.projects)
      const eng = one(r.eng)
      const days = ev?.at ? Math.floor((today - new Date(ev.at).getTime()) / 86_400_000) : 0
      return {
        id: r.id,
        wsCode: r.ws_code,
        projectCode: proj?.code ?? null,
        projectName: proj?.name ?? null,
        work: one(r.cc_sub_skills)?.name ?? one(r.cc_disciplines)?.name ?? 'Budget',
        amount: Number(r.total_amount ?? r.summary_total ?? 0),
        engineer: eng?.full_name ?? eng?.name ?? null,
        returnedBy: ev?.by ?? null,
        returnedAt: ev?.at ?? null,
        days,
        comment: ev?.comment ?? null,
        url: `/cost-control/working-sheets/${r.id}`,
      }
    })
    .sort((a, b) => b.days - a.days || b.amount - a.amount)

  return { items }
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}
