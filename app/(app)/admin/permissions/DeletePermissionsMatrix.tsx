'use client'
// Companion matrix — how each role can delete in each module:
//   none → no delete · direct → immediate · request → needs an approver.
// Styled to match the access matrix (grouped, icons, crosshair, sticky header).

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Check, Trash2, Ban, Send, Box } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TILE_TONES } from '@/lib/modules'
import { groupModules, moduleMetaMap } from './groups'
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

const MODE_PILL: Record<Mode, string> = {
  none:    'bg-gray-100 text-gray-500 border-gray-200',
  direct:  'bg-emerald-100 text-emerald-800 border-emerald-300',
  request: 'bg-amber-100 text-amber-800 border-amber-300',
}
const MODE_TINT: Record<Mode, string> = {
  none: '', direct: 'bg-emerald-50/40', request: 'bg-amber-50/40',
}

export default function DeletePermissionsMatrix({ modules, roles, roleLabels, initial }: Props) {
  const router = useRouter()
  const initialMap = useMemo<Record<Key, Row>>(() => {
    const m: Record<Key, Row> = {}
    for (const r of initial) m[`${r.role}::${r.module_slug}`] = r
    return m
  }, [initial])

  const [state, setState] = useState(initialMap)
  const [busyKey, setBusyKey] = useState<Key | null>(null)
  const [savedKey, setSavedKey] = useState<Key | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hoverRole, setHoverRole] = useState<Role | null>(null)
  const [hoverSlug, setHoverSlug] = useState<string | null>(null)

  const grouped = useMemo(() => groupModules(modules), [modules])

  function cellOf(role: Role, slug: string): Row {
    return state[`${role}::${slug}`] ?? { role, module_slug: slug, delete_mode: 'none', delete_approver_role: null }
  }

  async function persist(role: Role, slug: string, patch: Partial<Row>) {
    const k: Key = `${role}::${slug}`
    const before = cellOf(role, slug)
    const next: Row = { ...before, ...patch }
    setState(s => ({ ...s, [k]: next }))
    setBusyKey(k); setError(null)
    const { error } = await createClient()
      .from('role_permissions')
      .upsert({ role, module_slug: slug, delete_mode: next.delete_mode, delete_approver_role: next.delete_approver_role }, { onConflict: 'role,module_slug' })
    setBusyKey(null)
    if (error) { setState(s => ({ ...s, [k]: before })); setError(`${role} / ${slug}: ${error.message}`); return }
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

  const colCount = roles.length + 1

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-gray-900">Delete rules</h3>
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <Badge mode="none" /><Badge mode="direct" /><Badge mode="request" />
          </div>
          <span className="ml-auto text-[11px] text-gray-400">Click a cell to cycle · Admin deletes directly</span>
        </div>

        {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

        <div className="overflow-auto max-h-[70vh] rounded-xl border border-gray-200" onMouseLeave={() => { setHoverRole(null); setHoverSlug(null) }}>
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-gray-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 min-w-[220px]">Module</th>
                {roles.map(r => {
                  const hot = hoverRole === r
                  return (
                    <th key={r} className={cn('sticky top-0 z-20 border-b border-gray-200 px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-gray-700 min-w-[104px] transition-colors', hot ? 'bg-indigo-50' : 'bg-gray-50')}>
                      {roleLabels[r]?.label || r}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {grouped.map(group => (
                <GroupRowsFragment key={group.title} title={group.title} colCount={colCount}>
                  {group.mods.map(mod => {
                    const meta = moduleMetaMap.get(mod.slug)
                    const tone = meta ? TILE_TONES[meta.tone] : TILE_TONES.slate
                    const Icon = meta?.icon ?? Box
                    const rowHot = hoverSlug === mod.slug
                    return (
                      <tr key={mod.slug}>
                        <td className={cn('sticky left-0 z-10 border-b border-gray-100 px-3 py-2 transition-colors', rowHot ? 'bg-indigo-50/60' : 'bg-white')}>
                          <div className="flex items-center gap-2.5">
                            <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0', tone.bg, tone.ic)}><Icon className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900 leading-tight truncate">{mod.label}</div>
                              <div className="text-[11px] text-gray-400 font-mono truncate">{mod.slug}</div>
                            </div>
                          </div>
                        </td>
                        {roles.map(role => {
                          const cell = cellOf(role, mod.slug)
                          const k: Key = `${role}::${mod.slug}`
                          const busy = busyKey === k
                          const saved = savedKey === k
                          const isAdmin = role === ('admin' as Role)
                          const mode = isAdmin ? 'direct' : cell.delete_mode
                          const colHot = hoverRole === role
                          const tint = colHot || rowHot ? 'bg-indigo-50/50' : MODE_TINT[mode]
                          return (
                            <td key={role} className={cn('border-b border-gray-100 px-2 py-1.5 text-center align-top transition-colors', tint, saved && 'ring-1 ring-inset ring-green-300')}
                              onMouseEnter={() => { setHoverRole(role); setHoverSlug(mod.slug) }}>
                              <button type="button" onClick={() => cycleMode(role, mod.slug)} disabled={busy || isAdmin}
                                title={isAdmin ? 'Admin always has direct delete' : 'Click to cycle none → direct → request'}
                                className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold border transition-colors',
                                  isAdmin ? 'bg-blue-100 text-blue-700 border-blue-200 cursor-default' : MODE_PILL[cell.delete_mode],
                                  busy && 'opacity-60 cursor-wait')}>
                                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> :
                                  mode === 'direct' ? <Trash2 className="h-3 w-3" /> :
                                  mode === 'request' ? <Send className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                                {mode}
                              </button>
                              {cell.delete_mode === 'request' && !isAdmin && (
                                <div className="mt-1">
                                  <select value={cell.delete_approver_role ?? ''} onChange={e => persist(role, mod.slug, { delete_approver_role: e.target.value || null })} disabled={busy}
                                    className="h-7 rounded-md border border-gray-300 bg-white px-1 text-[11px]" title="Approver role">
                                    <option value="">— approver —</option>
                                    {roles.map(r => <option key={r} value={r as string}>{fmtRoleLabel(r as string, roleLabels)}</option>)}
                                  </select>
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </GroupRowsFragment>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function GroupRowsFragment({ title, colCount, children }: { title: string; colCount: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={colCount} className="sticky left-0 bg-white px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{title}</td>
      </tr>
      {children}
    </>
  )
}

function Badge({ mode }: { mode: Mode }) {
  const icon = mode === 'none' ? <Ban className="h-3 w-3" /> : mode === 'direct' ? <Trash2 className="h-3 w-3" /> : <Send className="h-3 w-3" />
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-semibold', MODE_PILL[mode])}>
      {icon}{mode}
    </span>
  )
}
