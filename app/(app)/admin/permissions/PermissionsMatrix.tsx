'use client'
import { bumpShell } from '@/lib/shell-actions'
import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, Pencil, ShieldCheck, Trash2, Loader2, Check, Plus, X, Sparkles, Box } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { TILE_TONES } from '@/lib/modules'
import { groupModules, moduleMetaMap, groupRoles, sortRolesByCategory } from './groups'
import type { Role, PermAction } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'

interface ModuleRef { slug: string; label: string }

// Delete rule per role×module: no delete / immediate / needs an approver.
type Mode = 'none' | 'direct' | 'request'

// A permission row incl. the delete columns (RolePermission itself doesn't
// carry delete_mode/approver).
export type PermRow = {
  role: Role
  module_slug: string
  can_view: boolean
  can_edit: boolean
  can_admin: boolean
  delete_mode?: Mode | null
  delete_approver_role?: string | null
}

interface Props {
  modules: ModuleRef[]
  roles: readonly Role[]
  initial: PermRow[]
  roleLabels: RoleLabelMap
  currentUserIsPortalOwner: boolean
  canManageRoles?: boolean
  /** Full module count for the "N/M" header even when the list is filtered. */
  totalModules?: number
}

type Key = `${string}::${string}` // `${role}::${slug}`
type CellState = { view: boolean; edit: boolean; admin: boolean; del: Mode; approver: string | null }

const ACTIONS: { key: PermAction; label: string; icon: React.ComponentType<{ className?: string }>; on: string }[] = [
  { key: 'view',  label: 'View',  icon: Eye,         on: 'bg-blue-100 text-blue-700' },
  { key: 'edit',  label: 'Edit',  icon: Pencil,      on: 'bg-amber-100 text-amber-800' },
  { key: 'admin', label: 'Admin', icon: ShieldCheck, on: 'bg-purple-100 text-purple-800' },
]

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

export default function PermissionsMatrix({ modules, roles, initial, roleLabels, currentUserIsPortalOwner, canManageRoles = false, totalModules }: Props) {
  const router = useRouter()
  const initialMap = useMemo<Record<Key, CellState>>(() => {
    const m: Record<Key, CellState> = {}
    for (const r of initial) {
      m[`${r.role}::${r.module_slug}`] = {
        view: !!r.can_view, edit: !!r.can_edit, admin: !!r.can_admin,
        del: (r.delete_mode ?? 'none') as Mode, approver: r.delete_approver_role ?? null,
      }
    }
    return m
  }, [initial])

  const [visibleRoles, setVisibleRoles] = useState<Role[]>(roles as Role[])
  const [state, setState] = useState(initialMap)
  const [busyKey, setBusyKey] = useState<Key | null>(null)
  const [savedKey, setSavedKey] = useState<Key | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  // Crosshair hover — highlight the hovered row + column so a wide matrix is
  // readable at a glance.
  const [hoverRole, setHoverRole] = useState<Role | null>(null)
  const [hoverSlug, setHoverSlug] = useState<string | null>(null)

  const grouped = useMemo(() => groupModules(modules), [modules])
  // Category-ordered roles so the matrix columns + legend cluster by category.
  const orderedRoles = useMemo(() => sortRolesByCategory(visibleRoles), [visibleRoles])
  const roleGroups = useMemo(() => groupRoles(orderedRoles), [orderedRoles])
  // The first role of each category (after the first) gets a divider border.
  const catStart = useMemo(() => new Set(roleGroups.slice(1).map(g => g.roles[0] as string)), [roleGroups])

  async function addRole(e: React.FormEvent) {
    e.preventDefault()
    if (!newRoleLabel.trim()) { setError('Role label required'); return }
    setAddBusy(true); setError(null)
    const supabase = createClient()
    const key = newRoleLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const { data, error } = await supabase.rpc('admin_add_role', {
      p_key: key, p_label: newRoleLabel.trim(), p_description: newRoleDesc.trim() || null,
    })
    setAddBusy(false)
    if (error) { setError(error.message); return }
    const finalKey = (data?.key as string) || key
    setVisibleRoles(rs => rs.includes(finalKey as Role) ? rs : [...rs, finalKey as Role])
    setLabels(m => ({ ...m, [finalKey]: { label: newRoleLabel.trim(), description: newRoleDesc.trim() } } as RoleLabelMap))
    setShowAddRole(false)
    setNewRoleLabel(''); setNewRoleDesc('')
    await bumpShell()
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
    await bumpShell()
    router.refresh()
  }

  async function commitLabelEdit(role: Role, nextLabel: string) {
    const trimmed = nextLabel.trim()
    if (!trimmed || trimmed === labels[role].label) return
    if (trimmed.length > 60) { setError('Role name too long (max 60 characters)'); return }
    setLabelBusy(role); setError(null)
    const prev = labels[role]
    setLabels(m => ({ ...m, [role]: { ...m[role], label: trimmed } }))
    const supabase = createClient()
    const { error } = await supabase.rpc('set_role_label', { p_role: role, p_label: trimmed, p_description: null })
    setLabelBusy(null)
    if (error) { setLabels(m => ({ ...m, [role]: prev })); setError(error.message || 'Could not rename role'); return }
    setLabelSaved(role)
    setTimeout(() => setLabelSaved(r => (r === role ? null : r)), 1500)
  }

  async function commitRoleMeta(role: Role, nextLabel: string, nextDesc: string) {
    const label = nextLabel.trim()
    const description = nextDesc.trim()
    if (!label) { setError('Role name cannot be empty'); return }
    if (label.length > 60) { setError('Role name too long (max 60 characters)'); return }
    setLabelBusy(role); setError(null)
    const prev = labels[role]
    setLabels(m => ({ ...m, [role]: { label, description } }))
    const { error } = await createClient().rpc('set_role_label', { p_role: role, p_label: label, p_description: description })
    setLabelBusy(null)
    if (error) { setLabels(m => ({ ...m, [role]: prev })); setError(error.message || 'Could not save role'); return }
    setLabelSaved(role)
    setTimeout(() => setLabelSaved(r => (r === role ? null : r)), 1500)
    await bumpShell()
    router.refresh()
  }

  function getCell(role: Role, slug: string): CellState {
    return state[`${role}::${slug}`] ?? { view: false, edit: false, admin: false, del: 'none', approver: null }
  }

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

  // Count from live state (not the possibly-filtered `modules`) so search
  // doesn't shrink the denominator or the tally.
  const totalMods = totalModules ?? modules.length
  const roleModuleCount = (role: Role) =>
    role === ('admin' as Role)
      ? totalMods
      : Object.entries(state).filter(([k, v]) => k.startsWith(`${role}::`) && v.view).length

  async function toggle(role: Role, slug: string, action: PermAction) {
    const key: Key = `${role}::${slug}`
    const current = getCell(role, slug)
    const next: CellState = { ...current, [action]: !current[action] }
    if (action === 'edit' && next.edit) next.view = true
    if (action === 'admin' && next.admin) { next.view = true; next.edit = true }
    if (action === 'view' && !next.view) { next.edit = false; next.admin = false }

    setState(s => ({ ...s, [key]: next }))
    setBusyKey(key); setError(null)

    const supabase = createClient()
    const { error } = await supabase
      .from('role_permissions')
      .upsert({ role, module_slug: slug, can_view: next.view, can_edit: next.edit, can_admin: next.admin, updated_at: new Date().toISOString() }, { onConflict: 'role,module_slug' })

    setBusyKey(null)
    if (error) {
      setError(`${role} / ${slug}: ${error.message}`)
      setState(s => ({ ...s, [key]: current }))
      return
    }
    setSavedKey(key)
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1500)
  }

  // Delete rule — cycles none → direct → request; only delete_* columns are
  // written, so it never touches the view/edit/admin flags on the same row.
  async function persistDelete(role: Role, slug: string, patch: { del?: Mode; approver?: string | null }) {
    const key: Key = `${role}::${slug}`
    const current = getCell(role, slug)
    const next: CellState = {
      ...current,
      del: patch.del ?? current.del,
      approver: 'approver' in patch ? (patch.approver ?? null) : current.approver,
    }
    setState(s => ({ ...s, [key]: next }))
    setBusyKey(key); setError(null)
    const { error } = await createClient()
      .from('role_permissions')
      .upsert({ role, module_slug: slug, delete_mode: next.del, delete_approver_role: next.approver, updated_at: new Date().toISOString() }, { onConflict: 'role,module_slug' })
    setBusyKey(null)
    if (error) { setError(`${role} / ${slug}: ${error.message}`); setState(s => ({ ...s, [key]: current })); return }
    setSavedKey(key)
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1500)
  }
  function cycleDelete(role: Role, slug: string) {
    const cur = getCell(role, slug).del
    const nextMode: Mode = cur === 'none' ? 'direct' : cur === 'direct' ? 'request' : 'none'
    const approver = nextMode === 'request' ? (getCell(role, slug).approver ?? 'admin') : null
    persistDelete(role, slug, { del: nextMode, approver })
  }
  const setApprover = (role: Role, slug: string, approver: string | null) => persistDelete(role, slug, { approver })

  const colCount = visibleRoles.length + 1

  return (
    <div className="space-y-4">
      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      <Card>
        <CardContent className="pt-5 space-y-4">
          {/* Header: summary + legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-base font-semibold text-gray-900">Access matrix</h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 tabular-nums">{visibleRoles.length} roles</span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 tabular-nums">{modules.length} modules</span>
            </span>
            <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
              {ACTIONS.map(a => (
                <span key={a.key} className="inline-flex items-center gap-1">
                  <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded', a.on)}><a.icon className="h-2.5 w-2.5" /></span>
                  {a.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-100 text-emerald-700"><Trash2 className="h-2.5 w-2.5" /></span>
                Delete
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-1">
            Click a cell to toggle — saves instantly. <b>Edit</b> auto-grants <b>View</b>; <b>Admin</b> auto-grants <b>View + Edit</b>; removing <b>View</b> clears the row. The <b>Delete</b> button cycles none → direct → needs-approval (pick an approver). Admin has full access always.
          </p>

          {canManageRoles && (
            <div>
              {!showAddRole ? (
                <Button size="sm" variant="outline" onClick={() => setShowAddRole(true)}>
                  <Plus className="h-4 w-4" /> Add role
                </Button>
              ) : (
                <form onSubmit={addRole} className="w-full flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-2 p-3 bg-blue-50/40 border border-blue-200 rounded-xl">
                  <div className="w-full sm:w-auto">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 mb-1 block">Role name</label>
                    <Input value={newRoleLabel} onChange={e => setNewRoleLabel(e.target.value)} placeholder="e.g. QC Inspector" disabled={addBusy} className="w-full sm:min-w-[12rem]" autoFocus />
                  </div>
                  <div className="w-full sm:flex-1 sm:min-w-[14rem]">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 block">Description (optional)</label>
                      <button type="button" disabled={aiAddBusy || addBusy || !newRoleLabel.trim()}
                        onClick={async () => { setAiAddBusy(true); setError(null); try { setNewRoleDesc(await fetchAiDescription(newRoleLabel, '')) } catch (e) { setError(e instanceof Error ? e.message : 'AI failed') } finally { setAiAddBusy(false) } }}
                        title="Let AI write the description from the role name"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40">
                        {aiAddBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Write with AI
                      </button>
                    </div>
                    <Input value={newRoleDesc} onChange={e => setNewRoleDesc(e.target.value)} placeholder="What this role can do…" disabled={addBusy} />
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button type="submit" size="sm" disabled={addBusy || !newRoleLabel.trim()} className="flex-1 sm:flex-none">
                      {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create role
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setShowAddRole(false); setNewRoleLabel(''); setNewRoleDesc('') }} disabled={addBusy}><X className="h-4 w-4" /> Cancel</Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Matrix */}
          <div className="overflow-auto max-h-[72vh] rounded-xl border border-gray-200" onMouseLeave={() => { setHoverRole(null); setHoverSlug(null) }}>
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                {/* Category band — spans each group's role columns (scrolls away; the role row below stays pinned). */}
                <tr>
                  <th className="sticky left-0 z-20 bg-gray-50 border-b border-gray-200" />
                  {roleGroups.map((g, gi) => (
                    <th key={g.title} colSpan={g.roles.length}
                      className={cn('bg-gray-50 border-b border-gray-200 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400', gi > 0 && 'border-l-2 border-l-slate-200')}>
                      {g.title}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-gray-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 min-w-[220px]">Module</th>
                  {orderedRoles.map(role => {
                    const rl = labels[role]
                    const busy = labelBusy === role
                    const saved = labelSaved === role
                    const delBusy = delBusyRole === role
                    const hot = hoverRole === role
                    return (
                      <th key={role} className={cn('sticky top-0 z-20 border-b border-gray-200 px-2 py-2 text-center align-bottom relative min-w-[132px] transition-colors', hot ? 'bg-indigo-50' : 'bg-gray-50', catStart.has(role) && 'border-l-2 border-l-slate-200')} title={rl?.description}>
                        {canManageRoles && role !== ('admin' as Role) && (
                          <button type="button" onClick={() => deactivateRole(role)} disabled={delBusy} title="Deactivate this role"
                            className="absolute top-0.5 right-0.5 h-4 w-4 inline-flex items-center justify-center rounded-full text-gray-300 hover:text-rose-600 hover:bg-rose-50">
                            {delBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          </button>
                        )}
                        {currentUserIsPortalOwner ? (
                          <input type="text" defaultValue={rl?.label || role} disabled={busy}
                            onBlur={e => commitLabelEdit(role, e.currentTarget.value)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { (e.target as HTMLInputElement).value = rl?.label || role; (e.target as HTMLInputElement).blur() } }}
                            maxLength={60}
                            className={cn('text-[11px] font-bold uppercase tracking-wide text-gray-700 w-full text-center bg-transparent rounded border border-transparent hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none px-1 py-0.5', busy && 'opacity-50', saved && 'border-green-300 bg-green-50')}
                            title="Click to rename · Enter to save · Esc to cancel" />
                        ) : (
                          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-700 leading-tight">{rl?.label || role}</div>
                        )}
                        <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-gray-400">
                          {role === ('admin' as Role) ? <span className="text-purple-500 font-semibold">full</span> : <span className="tabular-nums">{roleModuleCount(role)}/{totalMods}</span>}
                          {busy && <Loader2 className="h-3 w-3 animate-spin text-blue-600" />}
                          {saved && <Check className="h-3 w-3 text-green-600" />}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {grouped.map(group => (
                  <GroupRows key={group.title} title={group.title} mods={group.mods} colCount={colCount}
                    visibleRoles={orderedRoles} catStart={catStart} labels={labels} moduleMeta={moduleMetaMap} getCell={getCell}
                    busyKey={busyKey} savedKey={savedKey} hoverRole={hoverRole} hoverSlug={hoverSlug}
                    setHoverRole={setHoverRole} setHoverSlug={setHoverSlug} toggle={toggle}
                    cycleDelete={cycleDelete} setApprover={setApprover} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Roles — grouped by category to make setup easier. Descriptions also
          show on hover of each role column header in the matrix above. */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Roles by category</h3>
            <span className="text-[11px] text-gray-400">
              {currentUserIsPortalOwner ? 'Hover a role to rename it or edit its description — updates everywhere.' : 'Hover a role column above to see its description.'}
            </span>
          </div>
          <div className="space-y-4">
            {groupRoles(orderedRoles).map(g => (
              <div key={g.title}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{g.title}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.roles.map(r => (
                    <LegendRole key={r} label={labels[r]?.label || r} description={labels[r]?.description || ''} canEdit={currentUserIsPortalOwner}
                      busy={labelBusy === r} saved={labelSaved === r} onSave={(label, desc) => commitRoleMeta(r, label, desc)}
                      onAi={(name) => fetchAiDescription(name, roleContext(r))} onError={setError} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Grouped module rows ───────────────────────────────────────────────
function GroupRows({ title, mods, colCount, visibleRoles, catStart, labels, moduleMeta, getCell, busyKey, savedKey, hoverRole, hoverSlug, setHoverRole, setHoverSlug, toggle, cycleDelete, setApprover }: {
  title: string
  mods: ModuleRef[]
  colCount: number
  visibleRoles: Role[]
  catStart: Set<string>
  labels: RoleLabelMap
  moduleMeta: Map<string, { icon: React.ComponentType<{ className?: string }>; tone: keyof typeof TILE_TONES }>
  getCell: (role: Role, slug: string) => CellState
  busyKey: Key | null; savedKey: Key | null
  hoverRole: Role | null; hoverSlug: string | null
  setHoverRole: (r: Role | null) => void; setHoverSlug: (s: string | null) => void
  toggle: (role: Role, slug: string, action: PermAction) => void
  cycleDelete: (role: Role, slug: string) => void
  setApprover: (role: Role, slug: string, approver: string | null) => void
}) {
  return (
    <>
      <tr>
        <td colSpan={colCount} className="sticky left-0 bg-white px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{title}</td>
      </tr>
      {mods.map(mod => {
        const meta = moduleMeta.get(mod.slug)
        const tone = meta ? TILE_TONES[meta.tone] : TILE_TONES.slate
        const Icon = meta?.icon ?? Box
        const rowHot = hoverSlug === mod.slug
        return (
          <tr key={mod.slug} className="group">
            <td className={cn('sticky left-0 z-10 border-b border-gray-100 px-3 py-2 transition-colors', rowHot ? 'bg-indigo-50/60' : 'bg-white')}>
              <div className="flex items-center gap-2.5">
                <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0', tone.bg, tone.ic)}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 leading-tight truncate">{mod.label}</div>
                  <div className="text-[11px] text-gray-400 font-mono truncate">{mod.slug}</div>
                </div>
              </div>
            </td>
            {visibleRoles.map(role => {
              const cell = getCell(role, mod.slug)
              const k: Key = `${role}::${mod.slug}`
              const busy = busyKey === k
              const saved = savedKey === k
              const locked = role === ('admin' as Role)
              const colHot = hoverRole === role
              const level = locked || cell.admin ? 'admin' : cell.edit ? 'edit' : cell.view ? 'view' : 'none'
              const tint = colHot || rowHot ? 'bg-indigo-50/50'
                : level === 'admin' ? 'bg-purple-50/50' : level === 'edit' ? 'bg-amber-50/40' : level === 'view' ? 'bg-blue-50/40' : ''
              return (
                <td key={role} className={cn('border-b border-gray-100 px-2 py-1.5 text-center transition-colors', tint, catStart.has(role) && 'border-l-2 border-l-slate-200', saved && 'ring-1 ring-inset ring-green-300')}
                  onMouseEnter={() => { setHoverRole(role); setHoverSlug(mod.slug) }}>
                  <div className="inline-flex overflow-hidden rounded-md border border-gray-200 divide-x divide-gray-200 bg-white align-middle">
                    {ACTIONS.map(({ key, label, icon: I, on }) => {
                      const active = locked ? true : cell[key]
                      return (
                        <button key={key} onClick={() => { if (!locked) toggle(role, mod.slug, key) }} disabled={busy || locked}
                          title={locked ? 'Admin always has full access' : `${label}: ${active ? 'allowed — click to remove' : 'denied — click to allow'}`}
                          className={cn('inline-flex h-6 w-6 items-center justify-center transition-colors', active ? on : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50', busy && 'opacity-50 cursor-wait', locked && 'cursor-default')}>
                          {busy && key === 'view' ? <Loader2 className="h-3 w-3 animate-spin" /> : <I className="h-3 w-3" />}
                        </button>
                      )
                    })}
                    {(() => {
                      const del: Mode = locked ? 'direct' : cell.del
                      const dCls = del === 'direct' ? 'bg-emerald-100 text-emerald-700'
                        : del === 'request' ? 'bg-amber-100 text-amber-800'
                        : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'
                      const dTitle = locked ? 'Admin always deletes directly'
                        : `Delete: ${del === 'none' ? 'not allowed' : del === 'direct' ? 'direct' : 'needs approval'} — click to cycle`
                      return (
                        <button onClick={() => { if (!locked) cycleDelete(role, mod.slug) }} disabled={busy || locked} title={dTitle}
                          className={cn('inline-flex h-6 w-6 items-center justify-center transition-colors', dCls, busy && 'opacity-50 cursor-wait', locked && 'cursor-default')}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )
                    })()}
                  </div>
                  {cell.del === 'request' && !locked && (
                    <div className="mt-1">
                      <select value={cell.approver ?? ''} onChange={e => setApprover(role, mod.slug, e.target.value || null)} disabled={busy}
                        title="Who approves a delete request"
                        className="h-6 max-w-[104px] rounded-md border border-amber-300 bg-amber-50 px-1 text-[10px] text-amber-900">
                        <option value="">approver…</option>
                        {visibleRoles.map(r => <option key={r} value={r as string}>{labels[r]?.label || r}</option>)}
                      </select>
                    </div>
                  )}
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

// ─── One editable role entry in the Legend ─────────────────────────────
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
  useEffect(() => { if (!editing) { setL(label); setD(description) } }, [label, description, editing])

  async function runAi() {
    if (!l.trim()) { onError('Type a role name first.'); return }
    setAiBusy(true)
    try { setD(await onAi(l)) } catch (e) { onError(e instanceof Error ? e.message : 'AI failed') } finally { setAiBusy(false) }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-2 space-y-1.5">
        <Input value={l} onChange={e => setL(e.target.value)} placeholder="Role name" maxLength={60} className="h-8 text-sm font-semibold" autoFocus />
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Description</span>
          <button type="button" onClick={runAi} disabled={aiBusy || !l.trim()} title="Let AI write the description from the role name + its access"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40">
            {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Write with AI
          </button>
        </div>
        <textarea value={d} onChange={e => setD(e.target.value)} placeholder="What this role can do… (or tap “Write with AI”)" rows={2}
          className="w-full rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none" />
        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={busy || aiBusy || !l.trim()} onClick={() => { onSave(l, d); setEditing(false) }} className="h-7">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setL(label); setD(description); setEditing(false) }} className="h-7"><X className="h-3.5 w-3.5" /> Cancel</Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('group flex items-start gap-1.5 rounded-md px-1.5 py-1 border border-gray-100 bg-white', saved && 'bg-green-50 border-green-200')}>
      <div className="flex-1 min-w-0">
        <b className="text-gray-800 uppercase">{label}:</b>{' '}
        <span className="text-gray-500">{description || '—'}</span>
      </div>
      {canEdit && (
        <button type="button" onClick={() => setEditing(true)} title="Rename / edit description"
          className="flex-shrink-0 mt-0.5 h-5 w-5 inline-flex items-center justify-center rounded text-gray-300 group-hover:text-blue-600 hover:bg-blue-50">
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
