'use client'
import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, Pencil, ShieldCheck, Loader2, Check, Plus, X, Sparkles } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import type { Role, RolePermission, PermAction } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'

interface ModuleRef { slug: string; label: string }

interface Props {
  modules: ModuleRef[]
  roles: readonly Role[]
  initial: RolePermission[]
  roleLabels: RoleLabelMap
  currentUserIsPortalOwner: boolean
  canManageRoles?: boolean
}

type Key = `${string}::${string}` // `${role}::${slug}`
type CellState = { view: boolean; edit: boolean; admin: boolean }

const ACTIONS: { key: PermAction; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'view',  label: 'View',  icon: Eye },
  { key: 'edit',  label: 'Edit',  icon: Pencil },
  { key: 'admin', label: 'Admin', icon: ShieldCheck },
]

// Ask the AI route for a one-line role description. Throws on failure so the
// caller can surface a friendly message.
async function fetchAiDescription(roleName: string, context: string): Promise<string> {
  const res = await fetch('/api/ai/role-description', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roleName, context }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'AI could not write a description.')
  return (json?.description as string) || ''
}

export default function PermissionsMatrix({ modules, roles, initial, roleLabels, currentUserIsPortalOwner, canManageRoles = false }: Props) {
  const router = useRouter()
  const initialMap = useMemo<Record<Key, CellState>>(() => {
    const m: Record<Key, CellState> = {}
    for (const r of initial) {
      m[`${r.role}::${r.module_slug}`] = { view: !!r.can_view, edit: !!r.can_edit, admin: !!r.can_admin }
    }
    return m
  }, [initial])

  const [visibleRoles, setVisibleRoles] = useState<Role[]>(roles as Role[])
  const [state, setState] = useState(initialMap)
  const [busyKey, setBusyKey] = useState<Key | null>(null)
  const [savedKey, setSavedKey] = useState<Key | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Editable role labels (Portal Owner only). Mirrors the server-fetched map
  // and lets us update the UI optimistically as the Portal Owner types.
  const [labels, setLabels] = useState<RoleLabelMap>(roleLabels)
  const [labelBusy, setLabelBusy] = useState<Role | null>(null)
  const [labelSaved, setLabelSaved] = useState<Role | null>(null)

  // "+ Add role" form state
  const [showAddRole, setShowAddRole] = useState(false)
  const [newRoleLabel, setNewRoleLabel] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [aiAddBusy, setAiAddBusy] = useState(false)
  const [delBusyRole, setDelBusyRole] = useState<Role | null>(null)

  async function addRole(e: React.FormEvent) {
    e.preventDefault()
    if (!newRoleLabel.trim()) { setError('Role label required'); return }
    setAddBusy(true); setError(null)
    const supabase = createClient()
    // Derive the enum key from the label: lowercase + snake_case.
    const key = newRoleLabel.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const { data, error } = await supabase.rpc('admin_add_role', {
      p_key: key,
      p_label: newRoleLabel.trim(),
      p_description: newRoleDesc.trim() || null,
    })
    setAddBusy(false)
    if (error) { setError(error.message); return }
    const finalKey = (data?.key as string) || key
    // Update local state — append new role + label, reload server data
    setVisibleRoles(rs => rs.includes(finalKey as Role) ? rs : [...rs, finalKey as Role])
    setLabels(m => ({ ...m, [finalKey]: { label: newRoleLabel.trim(), description: newRoleDesc.trim() } } as RoleLabelMap))
    setShowAddRole(false)
    setNewRoleLabel(''); setNewRoleDesc('')
    router.refresh()
  }

  async function deactivateRole(role: Role) {
    if (!(await confirm(`Deactivate role "${labels[role]?.label || role}"? Existing data referencing it stays intact, but the role won't appear in new dropdowns or this matrix.`))) return
    setDelBusyRole(role); setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('admin_deactivate_role', { p_key: role as unknown as string })
    setDelBusyRole(null)
    if (error) { setError(error.message); return }
    setVisibleRoles(rs => rs.filter(r => r !== role))
    router.refresh()
  }

  async function commitLabelEdit(role: Role, nextLabel: string) {
    const trimmed = nextLabel.trim()
    if (!trimmed || trimmed === labels[role].label) return
    if (trimmed.length > 60) {
      setError('Role name too long (max 60 characters)')
      return
    }
    setLabelBusy(role); setError(null)
    const prev = labels[role]
    // Optimistic
    setLabels(m => ({ ...m, [role]: { ...m[role], label: trimmed } }))
    const supabase = createClient()
    const { error } = await supabase.rpc('set_role_label', {
      p_role: role, p_label: trimmed, p_description: null,
    })
    setLabelBusy(null)
    if (error) {
      // Revert
      setLabels(m => ({ ...m, [role]: prev }))
      setError(error.message || 'Could not rename role')
      return
    }
    setLabelSaved(role)
    setTimeout(() => setLabelSaved(r => (r === role ? null : r)), 1500)
  }

  // Edit BOTH the name and the description of a role (from the Legend). This is
  // what makes the legend "smart": rename or repurpose a role and its plain-
  // English explanation updates live + persists, everywhere it's shown.
  async function commitRoleMeta(role: Role, nextLabel: string, nextDesc: string) {
    const label = nextLabel.trim()
    const description = nextDesc.trim()
    if (!label) { setError('Role name cannot be empty'); return }
    if (label.length > 60) { setError('Role name too long (max 60 characters)'); return }
    setLabelBusy(role); setError(null)
    const prev = labels[role]
    // Optimistic — updates the legend, the matrix header, and every dropdown
    // that reads this map, immediately.
    setLabels(m => ({ ...m, [role]: { label, description } }))
    const { error } = await createClient().rpc('set_role_label', {
      p_role: role, p_label: label, p_description: description,
    })
    setLabelBusy(null)
    if (error) {
      setLabels(m => ({ ...m, [role]: prev }))
      setError(error.message || 'Could not save role')
      return
    }
    setLabelSaved(role)
    setTimeout(() => setLabelSaved(r => (r === role ? null : r)), 1500)
    router.refresh()
  }

  function getCell(role: Role, slug: string): CellState {
    return state[`${role}::${slug}`] ?? { view: false, edit: false, admin: false }
  }

  // A short summary of what a role can do across modules — fed to the AI so the
  // generated description matches the role's real access, not just its name.
  function roleContext(role: Role): string {
    const parts: string[] = []
    for (const m of modules) {
      const c = getCell(role, m.slug)
      if (c.admin) parts.push(`manage ${m.label}`)
      else if (c.edit) parts.push(`edit ${m.label}`)
      else if (c.view) parts.push(`view ${m.label}`)
    }
    return parts.slice(0, 14).join(', ')
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

          {canManageRoles && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {!showAddRole ? (
                <Button size="sm" variant="outline" onClick={() => setShowAddRole(true)}>
                  <Plus className="h-4 w-4" /> Add role
                </Button>
              ) : (
                <form onSubmit={addRole} className="w-full flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-2 p-3 bg-blue-50/40 border border-blue-200 rounded-xl">
                  <div className="w-full sm:w-auto">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 mb-1 block">Role name</label>
                    <Input
                      value={newRoleLabel}
                      onChange={e => setNewRoleLabel(e.target.value)}
                      placeholder="e.g. QC Inspector"
                      disabled={addBusy}
                      className="w-full sm:min-w-[12rem]"
                      autoFocus
                    />
                  </div>
                  <div className="w-full sm:flex-1 sm:min-w-[14rem]">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 block">Description (optional)</label>
                      <button
                        type="button"
                        disabled={aiAddBusy || addBusy || !newRoleLabel.trim()}
                        onClick={async () => {
                          setAiAddBusy(true); setError(null)
                          try { setNewRoleDesc(await fetchAiDescription(newRoleLabel, '')) }
                          catch (e) { setError(e instanceof Error ? e.message : 'AI failed') }
                          finally { setAiAddBusy(false) }
                        }}
                        title="Let AI write the description from the role name"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40"
                      >
                        {aiAddBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Write with AI
                      </button>
                    </div>
                    <Input
                      value={newRoleDesc}
                      onChange={e => setNewRoleDesc(e.target.value)}
                      placeholder="What this role can do…"
                      disabled={addBusy}
                    />
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button type="submit" size="sm" disabled={addBusy || !newRoleLabel.trim()} className="flex-1 sm:flex-none">
                      {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Create role
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setShowAddRole(false); setNewRoleLabel(''); setNewRoleDesc('') }} disabled={addBusy}>
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-xs uppercase tracking-wide text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[180px]">
                    Module
                  </th>
                  {visibleRoles.map(role => {
                    const rl = labels[role]
                    const busy = labelBusy === role
                    const saved = labelSaved === role
                    const delBusy = delBusyRole === role
                    return (
                      <th key={role} className="px-3 py-2.5 text-center align-bottom relative" title={rl?.description}>
                        {canManageRoles && role !== ('admin' as Role) && (
                          <button
                            type="button"
                            onClick={() => deactivateRole(role)}
                            disabled={delBusy}
                            title="Deactivate this role"
                            className="absolute top-0.5 right-0.5 h-4 w-4 inline-flex items-center justify-center rounded-full text-gray-300 hover:text-rose-600 hover:bg-rose-50"
                          >
                            {delBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          </button>
                        )}
                        {currentUserIsPortalOwner ? (
                          <input
                            type="text"
                            defaultValue={rl?.label || role}
                            disabled={busy}
                            onBlur={e => commitLabelEdit(role, e.currentTarget.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              else if (e.key === 'Escape') {
                                (e.target as HTMLInputElement).value = rl?.label || role
                                ;(e.target as HTMLInputElement).blur()
                              }
                            }}
                            maxLength={60}
                            className={cn(
                              'text-[11px] font-bold uppercase tracking-wide text-gray-700 w-full text-center bg-transparent rounded border border-transparent hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none px-1 py-0.5',
                              busy && 'opacity-50',
                              saved && 'border-green-300 bg-green-50',
                            )}
                            title="Click to rename · Enter to save · Esc to cancel"
                          />
                        ) : (
                          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-700">{rl?.label || role}</div>
                        )}
                        <div className="flex items-center justify-center gap-1 mt-2 text-[10px] text-gray-400">
                          <Eye className="h-3 w-3" />
                          <Pencil className="h-3 w-3" />
                          <ShieldCheck className="h-3 w-3" />
                          {busy && <Loader2 className="h-3 w-3 animate-spin text-blue-600" />}
                          {saved && <Check className="h-3 w-3 text-green-600" />}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {modules.map(mod => (
                  <tr key={mod.slug} className="border-t border-gray-100">
                    <td className="px-3 py-2 sticky left-0 bg-white z-10">
                      <div className="font-medium text-gray-900">{mod.label}</div>
                      <div className="text-xs text-gray-400 font-mono">{mod.slug}</div>
                    </td>
                    {visibleRoles.map(role => {
                      const cell = getCell(role, mod.slug)
                      const k: Key = `${role}::${mod.slug}`
                      const busy = busyKey === k
                      const saved = savedKey === k
                      // Admin is the super-role. Lock its column so nobody can
                      // accidentally strip admin's own access and lock the
                      // whole team out of this very screen.
                      const locked = role === 'admin'
                      return (
                        <td key={role} className={cn(
                          'px-2 py-2 text-center',
                          saved && 'bg-green-50 transition-colors',
                          role === 'admin' && 'bg-blue-50/40' // admin column gets a subtle accent
                        )}>
                          <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
                            {ACTIONS.map(({ key, label, icon: Icon }) => {
                              const on = locked ? true : cell[key]
                              return (
                                <button
                                  key={key}
                                  onClick={() => { if (!locked) toggle(role, mod.slug, key) }}
                                  disabled={busy || locked}
                                  title={locked ? 'Admin always has full access (locked)' : `${label}: ${on ? 'allowed' : 'denied'}`}
                                  className={cn(
                                    'inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors',
                                    on
                                      ? key === 'view' ? 'bg-blue-100 text-blue-700' :
                                        key === 'edit' ? 'bg-amber-100 text-amber-800' :
                                                          'bg-purple-100 text-purple-800'
                                      : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50',
                                    busy && 'opacity-50 cursor-wait',
                                    locked && 'cursor-default'
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
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Legend</h3>
            {currentUserIsPortalOwner && (
              <span className="text-[11px] text-gray-400">Hover a role below to rename it or edit its description — updates everywhere.</span>
            )}
          </div>
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
            {visibleRoles.map(r => (
              <LegendRole
                key={r}
                label={labels[r]?.label || r}
                description={labels[r]?.description || ''}
                canEdit={currentUserIsPortalOwner}
                busy={labelBusy === r}
                saved={labelSaved === r}
                onSave={(label, desc) => commitRoleMeta(r, label, desc)}
                onAi={(name) => fetchAiDescription(name, roleContext(r))}
                onError={setError}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── One editable role entry in the Legend ─────────────────────────────
// View: "Label: description" with a pencil (Portal Owner). Edit: name +
// description fields that save together, so the legend always matches reality.
function LegendRole({ label, description, canEdit, busy, saved, onSave, onAi, onError }: {
  label: string
  description: string
  canEdit: boolean
  busy: boolean
  saved: boolean
  onSave: (label: string, description: string) => void
  onAi: (name: string) => Promise<string>
  onError: (msg: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [l, setL] = useState(label)
  const [d, setD] = useState(description)
  const [aiBusy, setAiBusy] = useState(false)
  // Re-sync if the underlying value changes (e.g. renamed from the matrix header).
  useEffect(() => { if (!editing) { setL(label); setD(description) } }, [label, description, editing])

  async function runAi() {
    if (!l.trim()) { onError('Type a role name first.'); return }
    setAiBusy(true)
    try { setD(await onAi(l)) }
    catch (e) { onError(e instanceof Error ? e.message : 'AI failed') }
    finally { setAiBusy(false) }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2 space-y-1.5">
        <Input value={l} onChange={e => setL(e.target.value)} placeholder="Role name" maxLength={60} className="h-8 text-sm font-semibold" autoFocus />
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Description</span>
          <button
            type="button"
            onClick={runAi}
            disabled={aiBusy || !l.trim()}
            title="Let AI write the description from the role name + its access"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40"
          >
            {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Write with AI
          </button>
        </div>
        <textarea
          value={d}
          onChange={e => setD(e.target.value)}
          placeholder="What this role can do… (or tap “Write with AI”)"
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
        />
        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={busy || aiBusy || !l.trim()} onClick={() => { onSave(l, d); setEditing(false) }} className="h-7">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setL(label); setD(description); setEditing(false) }} className="h-7">
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('group flex items-start gap-1.5 rounded-md px-1 -mx-1', saved && 'bg-green-50')}>
      <div className="flex-1 min-w-0">
        <b className="text-gray-800">{label}:</b>{' '}
        <span className="text-gray-500">{description || '—'}</span>
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Rename / edit description"
          className="flex-shrink-0 mt-0.5 h-5 w-5 inline-flex items-center justify-center rounded text-gray-300 group-hover:text-blue-600 hover:bg-blue-50"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
