'use client'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Eye, Pencil, ShieldCheck, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Role, RolePermission, PermAction } from '@/lib/types'

interface ModuleRef { slug: string; label: string }

interface Props {
  modules: ModuleRef[]
  roles: readonly Role[]
  initial: RolePermission[]
}

type Key = `${string}::${string}` // `${role}::${slug}`
type CellState = { view: boolean; edit: boolean; admin: boolean }

const ACTIONS: { key: PermAction; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'view',  label: 'View',  icon: Eye },
  { key: 'edit',  label: 'Edit',  icon: Pencil },
  { key: 'admin', label: 'Admin', icon: ShieldCheck },
]

const ROLE_LABEL: Record<Role, string> = {
  admin:      'Admin',
  founder:    'Founder',
  head:       'Head',
  uploader:   'Uploader',
  engineer:   'Engineer',
  site_staff: 'Site Staff',
  viewer:     'Viewer',
}

const ROLE_DESC: Record<Role, string> = {
  admin:      'Super-user. Manages users + permissions.',
  founder:    'Top org level. Wide view, narrow edit.',
  head:       'PM / department head.',
  uploader:   'Edits operational data.',
  engineer:   'Site engineer. Field-level edits.',
  site_staff: 'Labour / on-site staff.',
  viewer:     'Read-only.',
}

export default function PermissionsMatrix({ modules, roles, initial }: Props) {
  const initialMap = useMemo<Record<Key, CellState>>(() => {
    const m: Record<Key, CellState> = {}
    for (const r of initial) {
      m[`${r.role}::${r.module_slug}`] = { view: !!r.can_view, edit: !!r.can_edit, admin: !!r.can_admin }
    }
    return m
  }, [initial])

  const [state, setState] = useState(initialMap)
  const [busyKey, setBusyKey] = useState<Key | null>(null)
  const [savedKey, setSavedKey] = useState<Key | null>(null)
  const [error, setError] = useState<string | null>(null)

  function getCell(role: Role, slug: string): CellState {
    return state[`${role}::${slug}`] ?? { view: false, edit: false, admin: false }
  }

  async function toggle(role: Role, slug: string, action: PermAction) {
    const key: Key = `${role}::${slug}`
    const current = getCell(role, slug)
    const next: CellState = { ...current, [action]: !current[action] }
    // Sensible cascade: edit → also view; admin → also view + edit
    if (action === 'edit' && next.edit) next.view = true
    if (action === 'admin' && next.admin) { next.view = true; next.edit = true }
    // Removing view also removes edit + admin
    if (action === 'view' && !next.view) { next.edit = false; next.admin = false }

    setState(s => ({ ...s, [key]: next }))
    setBusyKey(key); setError(null)

    const supabase = createClient()
    const { error } = await supabase
      .from('role_permissions')
      .upsert({
        role,
        module_slug: slug,
        can_view:  next.view,
        can_edit:  next.edit,
        can_admin: next.admin,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'role,module_slug' })

    setBusyKey(null)
    if (error) {
      setError(`${role} / ${slug}: ${error.message}`)
      // Revert
      setState(s => ({ ...s, [key]: current }))
      return
    }
    setSavedKey(key)
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1500)
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      <Card>
        <CardContent className="pt-5">
          <p className="text-sm text-gray-600 mb-4">
            Click any cell to toggle. Saves immediately. Cascading rules apply:
            granting <b>Edit</b> auto-grants <b>View</b>; granting <b>Admin</b> auto-grants <b>View + Edit</b>;
            removing <b>View</b> revokes <b>Edit + Admin</b>.
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wide text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[180px]">
                    Module
                  </th>
                  {roles.map(role => (
                    <th key={role} className="px-3 py-2.5 text-center align-bottom" title={ROLE_DESC[role]}>
                      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-700">{ROLE_LABEL[role]}</div>
                      <div className="flex items-center justify-center gap-1 mt-2 text-[10px] text-gray-400">
                        <Eye className="h-3 w-3" />
                        <Pencil className="h-3 w-3" />
                        <ShieldCheck className="h-3 w-3" />
                      </div>
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
                      const cell = getCell(role, mod.slug)
                      const k: Key = `${role}::${mod.slug}`
                      const busy = busyKey === k
                      const saved = savedKey === k
                      return (
                        <td key={role} className={cn(
                          'px-2 py-2 text-center',
                          saved && 'bg-green-50 transition-colors',
                          role === 'admin' && 'bg-blue-50/40' // admin column gets a subtle accent
                        )}>
                          <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
                            {ACTIONS.map(({ key, label, icon: Icon }) => {
                              const on = cell[key]
                              return (
                                <button
                                  key={key}
                                  onClick={() => toggle(role, mod.slug, key)}
                                  disabled={busy}
                                  title={`${label}: ${on ? 'allowed' : 'denied'}`}
                                  className={cn(
                                    'inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors',
                                    on
                                      ? key === 'view' ? 'bg-blue-100 text-blue-700' :
                                        key === 'edit' ? 'bg-amber-100 text-amber-800' :
                                                          'bg-purple-100 text-purple-800'
                                      : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50',
                                    busy && 'opacity-50 cursor-wait'
                                  )}
                                >
                                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                                </button>
                              )
                            })}
                          </div>
                          {saved && (
                            <div className="text-[10px] text-green-700 font-semibold mt-0.5 flex items-center justify-center gap-0.5">
                              <Check className="h-2.5 w-2.5" /> saved
                            </div>
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

      {/* Legend */}
      <Card>
        <CardContent className="pt-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Legend</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="flex items-start gap-2">
              <Badge variant="default" className="mt-0.5"><Eye className="h-3 w-3 mr-1 inline" />View</Badge>
              <span className="text-gray-600">Can see the module + read all data inside it.</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="warning" className="mt-0.5"><Pencil className="h-3 w-3 mr-1 inline" />Edit</Badge>
              <span className="text-gray-600">Can create, update, or change records.</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge className="bg-purple-100 text-purple-800 mt-0.5"><ShieldCheck className="h-3 w-3 mr-1 inline" />Admin</Badge>
              <span className="text-gray-600">Top-level control (delete, settings, etc.).</span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
            {roles.map(r => (
              <div key={r}><b className="text-gray-800">{ROLE_LABEL[r]}:</b> <span className="text-gray-500">{ROLE_DESC[r]}</span></div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
