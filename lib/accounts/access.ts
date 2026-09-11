// Who may use the Accounts routes: cost-control view AND the named Accounts
// list (admins and the Portal Owner always) — the same gate the tab has.

import { getMyPermissions, can, getMyUser } from '@/lib/auth'
import { canOpenAccounts } from '@/lib/revamp/accounts-access'
import { createClient } from '@/lib/supabase/server'

export async function requireAccounts(projectId: string): Promise<{ ok: true; userId: string; project: { id: string; label: string } } | { ok: false; status: number; reason: string }> {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'view')) return { ok: false, status: 403, reason: 'Forbidden' }
  if (!(await canOpenAccounts())) return { ok: false, status: 403, reason: 'Accounts is for the named accounts people' }
  const me = await getMyUser()
  if (!me?.id) return { ok: false, status: 401, reason: 'Not signed in' }
  const supabase = await createClient()
  const { data } = await supabase.from('projects').select('id, code, name, short_name').eq('id', projectId).maybeSingle()
  if (!data) return { ok: false, status: 404, reason: 'No such project' }
  const p = data as { id: string; code: string | null; name: string; short_name: string | null }
  return { ok: true, userId: me.id, project: { id: p.id, label: p.short_name?.trim() || p.code || p.name } }
}

/** Safe for a filename: "NGH-B". */
export const fileSlug = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project'
