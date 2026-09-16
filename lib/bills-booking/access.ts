import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can, isModuleEnabled } from '@/lib/auth'

/** The one gate for every Bills Approval screen — and who the caller is on it.
 *
 *  Until 16 Sep 2026 this asked for `admin` and nothing else, so the section
 *  was one person's. Aksha, on the look-and-feel preview: "A, B, C, E, F Build
 *  it" — screen A is the register as a DESK sees it, which needs the desks to
 *  be able to open the door.
 *
 *  Two ways in, either is enough:
 *
 *   · the permissions matrix says `view` — after the go-live migration that is
 *     admin, billing, backoffice, project_head, founder, and now head and
 *     engineer, the two roles that actually sit at the desks;
 *   · the caller is on a desk — named in bb_desk_members, the Atm Head of a
 *     sub-project, or a Cost Control head. A viewer put on a desk gets in on
 *     that alone, because being on the desk IS the job.
 *
 *  What comes back is not a boolean but who you are here, so the landing page
 *  can say "yours" and the bill page can show your actions — resolved once per
 *  request and cached, not re-asked by every component. */
export interface BillsMe {
  userId: string | null
  /** The matrix's admin bit — sees every desk, changes the desks. */
  isAdmin: boolean
  /** The matrix's edit bit — the ERP entry team, who are on no desk but enter
   *  and move bills. */
  canEdit: boolean
  desks: Array<{ desk: string; projectId: string | null; subprojectId: number | null }>
  atmProjects: string[]
  atmSubprojects: number[]
  /** On any desk at all, by any of the three routes. */
  onAnyDesk: boolean
}

interface MyDesksRpc {
  desks?: Array<{ desk: string; project_id: string | null; in4_subproject_id: number | null }>
  atm_projects?: string[]
  atm_subprojects?: number[]
}

const whoAmI = cache(async (): Promise<BillsMe> => {
  const [perms, supabase] = await Promise.all([getMyPermissions(), createClient()])
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = await supabase.rpc('bb_rpc_my_desks')
  const r = (data ?? {}) as MyDesksRpc
  const desks = (r.desks ?? []).map(d => ({ desk: d.desk, projectId: d.project_id, subprojectId: d.in4_subproject_id }))
  const atmProjects = r.atm_projects ?? []
  const atmSubprojects = r.atm_subprojects ?? []
  return {
    userId: user?.id ?? null,
    isAdmin: can(perms, 'bills-booking', 'admin'),
    canEdit: can(perms, 'bills-booking', 'edit'),
    desks, atmProjects, atmSubprojects,
    onAnyDesk: desks.length > 0 || atmProjects.length > 0 || atmSubprojects.length > 0,
  }
})

export async function requireBillsAccess(): Promise<BillsMe> {
  const perms = await getMyPermissions()
  if (!(await isModuleEnabled('bills-booking'))) redirect('/dashboard')
  const me = await whoAmI()
  if (!can(perms, 'bills-booking', 'view') && !me.onAnyDesk) redirect('/dashboard')
  return me
}

/** For anything that changes a bill. Who may change WHICH bill is decided
 *  per bill in `bb_rpc_move` — this only asks whether the caller can change
 *  any: an admin, the matrix's editors, or somebody on a desk. */
export async function requireBillsWrite(): Promise<BillsMe> {
  const me = await requireBillsAccess()
  if (!(me.isAdmin || me.canEdit || me.onAnyDesk)) redirect('/bills-booking')
  return me
}

/** Setup — who sits where, what books where, sanctions. Admins only, as it
 *  was before the desks were let in; opening the register to a Site Head must
 *  not open the desks grid to them. */
export async function requireBillsAdmin(): Promise<BillsMe> {
  const me = await requireBillsAccess()
  if (!me.isAdmin) redirect('/bills-booking')
  return me
}

/** Read-only: who the caller is, without redirecting. For components that
 *  render differently for a desk member but must not throw a viewer out. */
export const billsMe = whoAmI
