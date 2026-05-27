'use client'
// Companion matrix that controls how each role can delete in each module:
//   - none    → no delete button
//   - direct  → immediate delete
//   - request → file a delete request, approver acts on it
// When a cell is set to "request", a small approver-role dropdown appears.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Check, Trash2, Ban, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Role } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'

type Mode = 'none' | 'direct' | 'request'

interface Row {
  role: Role
  module_slug: string
  delete_mode: Mode
  delete_approver_role: string | null
}

interface Props {
  modules: { slug: string; label: string }[]
  roles: readonly Role[]
  roleLabels: RoleLabelMap
  initial: Row[]
}

type Key = `${string}::${string}`

function fmtRoleLabel(r: string | null | undefined, labels: RoleLabelMap): string {
  if (!r) return '—'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (labels as any)[r]?.label || r
}

export default function DeletePermissionsMatrix({ modules, roles, roleLabels, initial }: Props) {
  const router = useRouter()
  const initialMap = useMemo<Record<Key, Row>>(() => {
    const m: Record<Key, Row> = {}
    for (const r of initial) {
      m[`${r.role}::${r.module_slug}`] = r
    }
    return m
  }, [initial])

  const [state, setState] = useState(initialMap)
  const [busyKey, setBusyKey] = useState<Key | null>(null)
  const [savedKey, setSavedKey] = useState<Key | null>(null)
  const [error, setError] = useState<string | null>(null)

  function cellOf(role: Role, slug: string): Row {
    return state[`${role}::${slug}`] ?? {
      role, module_slug: slug, delete_mode: 'none', delete_approver_role: null,
    }
  }

  async function persist(role: Role, slug: string, patch: Partial<Row>) {
    const k: Key = `${role}::${slug}`
    const before = cellOf(role, slug)
    const next: Row = { ...before, ...patch }
    setState(s => ({ ...s, [k]: next }))
    setBusyKey(k); setError(null)
    const { error } = await createClient()
      .from('role_permissions')
      .upsert({
        role,
        module_slug: slug,
        // We don't touch can_view/can_edit/can_admin here — the upsert
        // will only set the columns we include. If the row doesn't exist
        // yet, defaults from the table (false) apply.
        delete_mode: next.delete_mode,
        delete_approver_role: next.delete_approver_role,
      }, { onConflict: 'role,module_slug' })
    setBusyKey(null)
    if (error) {
      setState(s => ({ ...s, [k]: before }))
      setError(`${role} / ${slug}: ${error.message}`)
      return
    }
    setSavedKey(k)
    setTimeout(() => setSavedKey(x => (x === k ? null : x)), 1200)
    router.refresh()
  }

  function cycleMode(role: Role, slug: string) {
    const cur = cellOf(role, slug).delete_mode
    const next: Mode = cur === 'none' ? 'direct' : cur === 'direct' ? 'request' : 'none'
    const approver = next === 'request' ? (cellOf(role, slug).delete_approver_role ?? 'admin') : null
    persist(role, slug, { delete_mode: next, delete_approver_role: approver })
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-bold text-gray-900">Delete permissions</h2>
          <span className="text-xs text-gray-500">Per role × module · click to cycle</span>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          For each role and module, choose how delete works:
          <Badge mode="none" /> no delete,
          <Badge mode="direct" /> immediate delete,
          <Badge mode="request" /> delete needs approval — pick which role approves.
          Admin always has direct delete.
        </p>

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wide text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[180px]">
                  Module
                </th>
                {roles.map(r => (
                  <th key={r} className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-gray-700">
                    {roleLabels[r]?.label || r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map(mod => (
                <tr key={mod.slug} className="border-t border-gray-100">
                  <td className="px-3 py-2 sticky left-0 bg-white z-10">
                    <div className="font-medium text-gray-900">{mod.label}</div>
                    <div className="text-xs text-gray-400 font-mono">{mod.slug}</div>
                  </td>
                  {roles.map(role => {
                    const cell = cellOf(role, mod.slug)
                    const k: Key = `${role}::${mod.slug}`
                    const busy = busyKey === k
                    const saved = savedKey === k
                    return (
                      <td key={role} className={cn(
                        'px-2 py-2 text-center align-top',
                        saved && 'bg-green-50 transition-colors',
                      )}>
                        <button
                          type="button"
                          onClick={() => cycleMode(role, mod.slug)}
                          disabled={busy || role === ('admin' as Role)}
                          title={
                            role === ('admin' as Role)
                              ? 'Admin always has direct delete'
                              : 'Click to cycle none → direct → request'
                          }
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold border transition-colors',
                            role === ('admin' as Role) ? 'bg-blue-100 text-blue-700 border-blue-200 cursor-default' :
                            cell.delete_mode === 'direct'  ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                            cell.delete_mode === 'request' ? 'bg-amber-100 text-amber-800 border-amber-300' :
                                                              'bg-gray-100 text-gray-500 border-gray-200',
                            busy && 'opacity-60 cursor-wait',
                          )}
                        >
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> :
                            cell.delete_mode === 'direct'  ? <Trash2 className="h-3 w-3" /> :
                            cell.delete_mode === 'request' ? <Send  className="h-3 w-3" /> :
                                                              <Ban   className="h-3 w-3" />}
                          {role === ('admin' as Role) ? 'direct' : cell.delete_mode}
                        </button>

                        {cell.delete_mode === 'request' && role !== ('admin' as Role) && (
                          <div className="mt-1">
                            <select
                              value={cell.delete_approver_role ?? ''}
                              onChange={e => persist(role, mod.slug, { delete_approver_role: e.target.value || null })}
                              disabled={busy}
                              className="h-7 rounded-md border border-gray-300 bg-white px-1 text-[11px]"
                              title="Approver role"
                            >
                              <option value="">— pick approver —</option>
                              {roles.map(r => (
                                <option key={r} value={r as string}>{fmtRoleLabel(r as string, roleLabels)}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {saved && (
                          <div className="text-[10px] text-green-700 font-semibold mt-0.5 inline-flex items-center gap-0.5"><Check className="h-2.5 w-2.5" /> saved</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function Badge({ mode }: { mode: Mode }) {
  const map = {
    none:    { cls: 'bg-gray-100 text-gray-500 border-gray-200',         icon: <Ban   className="h-3 w-3" /> },
    direct:  { cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: <Trash2 className="h-3 w-3" /> },
    request: { cls: 'bg-amber-100 text-amber-800 border-amber-300',       icon: <Send  className="h-3 w-3" /> },
  } as const
  const { cls, icon } = map[mode]
  return (
    <span className={cn('inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded-full border text-[11px] font-semibold align-middle', cls)}>
      {icon}{mode}
    </span>
  )
}
