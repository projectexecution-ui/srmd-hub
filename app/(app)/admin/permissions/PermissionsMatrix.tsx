'use client'
import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, Pencil, ShieldCheck, Loader2, Check, Plus, X, Sparkles, Box } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { MODULES, TILE_TONES } from '@/lib/modules'
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

const ACTIONS: { key: PermAction; label: string; icon: React.ComponentType<{ className?: string }>; on: string }[] = [
  { key: 'view',  label: 'View',  icon: Eye,         on: 'bg-blue-100 text-blue-700' },
  { key: 'edit',  label: 'Edit',  icon: Pencil,      on: 'bg-amber-100 text-amber-800' },
  { key: 'admin', label: 'Admin', icon: ShieldCheck, on: 'bg-purple-100 text-purple-800' },
]

// Professional grouping so a long module list scans in sections. Any slug not
// listed here lands in "Other" — nothing is ever hidden.
const MODULE_GROUPS: { title: string; slugs: string[] }[] = [
  { title: 'Inbox & approvals', slugs: ['approvals', 'ecc'] },
  { title: 'Procurement', slugs: ['indents', 'pos', 'grns', 'invoices', 'payments', 'vendors', 'procurement-tracker', 'comparison', 'established-rates'] },
  { title: 'Cost & bills', slugs: ['cost-control', 'budget-vs-actual', 'budget-vs-actual-v2', 'bills-pipeline', 'stuck-bills', 'contractor-report', 'supplier-report'] },
  { title: 'Site & field', slugs: ['schedule', 'daily-site-report', 'jmr', 'inventory', 'projects', 'attendance'] },
  { title: 'Data & tools', slugs: ['uploads', 'blueprint-demo'] },
  { title: 'Admin', slugs: ['admin-users', 'admin-settings', 'admin-permissions'] },
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

  const moduleMeta = useMemo(() => {
    const m = new Map<string, { icon: React.ComponentType<{ className?: string }>; tone: keyof typeof TILE_TONES }>()
    for (const mod of MODULES) m.set(mod.slug, { icon: mod.icon, tone: mod.tone })
    return m
  }, [])

  const grouped = useMemo(() => {
    const bySlug = new Map(modules.map(m => [m.slug, m]))
    const used = new Set<string>()
    const out: { title: string; mods: ModuleRef[] }[] = []
    for (const g of MODULE_GROUPS) {
      const mods = g.slugs.map(s => bySlug.get(s)).filter(Boolean) as ModuleRef[]
      mods.forEach(m => used.add(m.slug))
      if (mods.length) out.push({ title: g.title, mods })
    }
    const others = modules.filter(m => !used.has(m.slug))
    if (others.length) out.push({ title: 'Other', mods: others })
    return out
  }, [modules])

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
    router.refresh()
  }

  function getCell(role: Role, slug: string): CellState {
    return state[`${role}::${slug}`] ?? { view: false, edit: false, admin: false }
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

  const roleModuleCount = (role: Role) => modules.reduce((n, m) => n + (role === ('admin' as Role) || getCell(role, m.slug).view ? 1 : 0), 0)

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
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-1">
            Click any cell to toggle — saves instantly. <b>Edit</b> auto-grants <b>View</b>; <b>Admin</b> auto-grants <b>View + Edit</b>; removing <b>View</b> clears the row. Admin has full access always.
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
          <div className="overflow-x-auto rounded-xl border border-gray-200" onMouseLeave={() => { setHoverRole(null); setHoverSlug(null) }}>
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 bg-gray-50 border-b border-gray-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 min-w-[220px]">Module</th>
                  {visibleRoles.map(role => {
                    const rl = labels[role]
                    const busy = labelBusy === role
                    const saved = labelSaved === role
                    const delBusy = delBusyRole === role
                    const hot = hoverRole === role
                    return (
                      <th key={role} className={cn('border-b border-gray-200 px-2 py-2 text-center align-bottom relative min-w-[104px] transition-colors', hot ? 'bg-indigo-50' : 'bg-gray-50')} title={rl?.description}>
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
                          {role === ('admin' as Role) ? <span className="text-purple-500 font-semibold">full</span> : <span className="tabular-nums">{roleModuleCount(role)}/{modules.length}</span>}
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
                    visibleRoles={visibleRoles} moduleMeta={moduleMeta} getCell={getCell}
                    busyKey={busyKey} savedKey={savedKey} hoverRole={hoverRole} hoverSlug={hoverSlug}
                    setHoverRole={setHoverRole} setHoverSlug={setHoverSlug} toggle={toggle} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Legend — role descriptions (editable) */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Roles</h3>
            {currentUserIsPortalOwner && <span className="text-[11px] text-gray-400">Hover a role to rename it or edit its description — updates everywhere.</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {visibleRoles.map(r => (
              <LegendRole key={r} label={labels[r]?.label || r} description={labels[r]?.description || ''} canEdit={currentUserIsPortalOwner}
                busy={labelBusy === r} saved={labelSaved === r} onSave={(label, desc) => commitRoleMeta(r, label, desc)}
                onAi={(name) => fetchAiDescription(name, roleContext(r))} onError={setError} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Grouped module rows ───────────────────────────────────────────────
function GroupRows({ title, mods, colCount, visibleRoles, moduleMeta, getCell, busyKey, savedKey, hoverRole, hoverSlug, setHoverRole, setHoverSlug, toggle }: {
  title: string
  mods: ModuleRef[]
  colCount: number
  visibleRoles: Role[]
  moduleMeta: Map<string, { icon: React.ComponentType<{ className?: string }>; tone: keyof typeof TILE_TONES }>
  getCell: (role: Role, slug: string) => CellState
  busyKey: Key | null; savedKey: Key | null
  hoverRole: Role | null; hoverSlug: string | null
  setHoverRole: (r: Role | null) => void; setHoverSlug: (s: string | null) => void
  toggle: (role: Role, slug: string, action: PermAction) => void
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
                <td key={role} className={cn('border-b border-gray-100 px-2 py-1.5 text-center transition-colors', tint, saved && 'ring-1 ring-inset ring-green-300')}
                  onMouseEnter={() => { setHoverRole(role); setHoverSlug(mod.slug) }}>
                  <div className="inline-flex overflow-hidden rounded-md border border-gray-200 divide-x divide-gray-200 bg-white">
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
                  </div>
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
        <b className="text-gray-800">{label}:</b>{' '}
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
