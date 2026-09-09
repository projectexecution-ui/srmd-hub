'use client'
import { bumpShell } from '@/lib/shell-actions'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Eye, EyeOff, Pencil, ShieldCheck, Trash2, Loader2, Check, Plus, X, Sparkles, Box, ChevronRight, ChevronDown, RotateCcw,
  BarChart3, CircleCheck, Layers, CreditCard, ClipboardList, GitBranch, Package, Ruler, CalendarDays, FileText, FileBarChart, Users, MessageSquare, Briefcase, Settings2,
  type LucideIcon,
} from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { TILE_TONES } from '@/lib/modules'
import { moduleMetaMap, groupRoles, sortRolesByCategory } from './groups'
import { tabAccessFull, subAccessFull, tabSlug, isWsSlug, ALL_TABS, type MatrixSection, type MatrixRow, type PermLike, type Access } from '@/lib/revamp/permissions'
import type { WorkspaceTab } from '@/lib/revamp/workspace'
import type { Role, PermAction } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'

/**
 * The matrix, revamp shape (Aksha, 10 Sep 2026).
 *
 * Three kinds of row:
 *   tab     ws:<tab>          — may the role OPEN this tab of a project?
 *   pill    ws:<tab>:<pill>   — may the role open this pill of the tab?
 *   module  <slug>            — what the role can DO: View · Edit · Admin · Delete,
 *                               exactly as before.
 * A tab or pill with no row of its own INHERITS — the tab from its module, the
 * pill from its tab — and shows as a dashed cell. One click writes a row of
 * its own; the ↺ takes it back to inheriting. Only View exists on a tab or a
 * pill: what a role can do inside is the module's Edit and Admin, because that
 * is what every screen checks. See lib/revamp/permissions.ts.
 */

// Delete rule per role×module: no delete / immediate / needs an approver.
type Mode = 'none' | 'direct' | 'request'

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
  sections: MatrixSection[]
  /** A search is on: every pill shows. */
  searching?: boolean
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

const TAB_ICONS: Record<string, LucideIcon> = {
  BarChart3, CircleCheck, Layers, CreditCard, ClipboardList, GitBranch, Package, Ruler, ShieldCheck, CalendarDays, FileText, FileBarChart, Users, MessageSquare, Briefcase, Settings2,
}
const TAB_BY_SLUG = new Map<string, WorkspaceTab>(ALL_TABS.map(t => [tabSlug(t), t]))

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

export default function PermissionsMatrix({ sections, searching = false, roles, initial, roleLabels, currentUserIsPortalOwner, canManageRoles = false, totalModules }: Props) {
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

  // Which tabs show their pills (collapsed by default — 45 pill rows would bury the tabs).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const allTabSlugs = useMemo(() => sections.flatMap(s => s.rows).filter(r => r.kind === 'tab').map(r => r.slug), [sections])

  // Crosshair hover — highlight the hovered row + column so a wide matrix is readable at a glance.
  const [hoverRole, setHoverRole] = useState<Role | null>(null)
  const [hoverSlug, setHoverSlug] = useState<string | null>(null)

  const orderedRoles = useMemo(() => sortRolesByCategory(visibleRoles), [visibleRoles])
  const roleGroups = useMemo(() => groupRoles(orderedRoles), [orderedRoles])
  const catStart = useMemo(() => new Set(roleGroups.slice(1).map(g => g.roles[0] as string)), [roleGroups])

  // The permission map each role would get from my_permissions(), built from the cells — what the workspace's own rule reads.
  const permsByRole = useMemo(() => {
    const out = new Map<Role, PermLike>()
    for (const role of orderedRoles) {
      const p: PermLike = {}
      const prefix = `${role}::`
      for (const [k, v] of Object.entries(state)) if (k.startsWith(prefix)) p[k.slice(prefix.length)] = { view: v.view, edit: v.edit, admin: v.admin }
      out.set(role, p)
    }
    return out
  }, [state, orderedRoles])

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
  const hasOwnRow = (role: Role, slug: string) => `${role}::${slug}` in state

  /** What a tab or pill row resolves to for a role — View · Edit · Admin and the delete rule — and whether that came from a row of its own. */
  function wsEffective(role: Role, row: MatrixRow): { a: Access; own: boolean; del: Mode; approver: string | null; from: string } {
    const perms = permsByRole.get(role) ?? {}
    const none = { a: { view: false, edit: false, admin: false }, own: false, del: 'none' as Mode, approver: null, from: '' }
    if (row.kind === 'tab') {
      const tab = TAB_BY_SLUG.get(row.slug)
      if (!tab) return none
      const f = tabAccessFull(perms, tab)
      const own = f.source === 'tab'
      const src = own ? getCell(role, row.slug) : getCell(role, row.inherits ?? '')
      return { a: { view: f.view, edit: f.edit, admin: f.admin }, own, del: src.del, approver: src.approver, from: own ? '' : `inherits ${row.hint?.replace(/^coming soon · /, '') ?? row.inherits}` }
    }
    const tab = TAB_BY_SLUG.get(row.parent ?? '')
    if (!tab) return none
    const f = subAccessFull(perms, tab, row.label)
    const tabEff = tabAccessFull(perms, tab)
    const delSrc = f.own ? getCell(role, row.slug) : tabEff.source === 'tab' ? getCell(role, row.parent ?? '') : getCell(role, tab.built ? tab.permissionSlug : 'cost-control')
    return { a: { view: f.view, edit: f.edit, admin: f.admin }, own: f.own, del: delSrc.del, approver: delSrc.approver, from: f.own ? '' : `inherits the ${tab.ribbon} tab` }
  }

  function roleContext(role: Role): string {
    const parts: string[] = []
    for (const s of sections) for (const m of s.rows) {
      if (m.kind !== 'module') continue
      const c = getCell(role, m.slug)
      if (c.admin) parts.push(`manage ${m.label}`)
      else if (c.edit) parts.push(`edit ${m.label}`)
      else if (c.view) parts.push(`view ${m.label}`)
    }
    return parts.slice(0, 14).join(', ')
  }

  // Count from live state (not the possibly-filtered rows) so search doesn't shrink the denominator or the tally. Modules only — tabs and pills inherit.
  const totalMods = totalModules ?? sections.flatMap(s => s.rows).filter(r => r.kind === 'module').length
  const roleModuleCount = (role: Role) =>
    role === ('admin' as Role)
      ? totalMods
      : Object.entries(state).filter(([k, v]) => k.startsWith(`${role}::`) && v.view && !isWsSlug(k.slice(`${role}::`.length))).length

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

  /** A tab or pill: one click writes a row of its own — what the role gets today, with this action flipped, under the same rules as a power. */
  async function toggleWs(role: Role, row: MatrixRow, action: PermAction) {
    const eff = wsEffective(role, row)
    const next: CellState = { view: eff.a.view, edit: eff.a.edit, admin: eff.a.admin, del: eff.del, approver: eff.approver }
    next[action] = !next[action]
    if (action === 'edit' && next.edit) next.view = true
    if (action === 'admin' && next.admin) { next.view = true; next.edit = true }
    if (action === 'view' && !next.view) { next.edit = false; next.admin = false }
    await writeWs(role, row, next)
  }

  /** The delete rule on a tab or pill: none → direct → needs approval, written with the flags the row resolves to today. */
  async function cycleDeleteWs(role: Role, row: MatrixRow) {
    const eff = wsEffective(role, row)
    const nextMode: Mode = eff.del === 'none' ? 'direct' : eff.del === 'direct' ? 'request' : 'none'
    await writeWs(role, row, { view: eff.a.view, edit: eff.a.edit, admin: eff.a.admin, del: nextMode, approver: nextMode === 'request' ? (eff.approver ?? 'admin') : null })
  }
  async function setApproverWs(role: Role, row: MatrixRow, approver: string | null) {
    const eff = wsEffective(role, row)
    await writeWs(role, row, { view: eff.a.view, edit: eff.a.edit, admin: eff.a.admin, del: eff.del, approver })
  }

  async function writeWs(role: Role, row: MatrixRow, next: CellState) {
    const key: Key = `${role}::${row.slug}`
    const before = state[key]
    setState(s => ({ ...s, [key]: next }))
    setBusyKey(key); setError(null)
    const { error } = await createClient()
      .from('role_permissions')
      .upsert({ role, module_slug: row.slug, can_view: next.view, can_edit: next.edit, can_admin: next.admin, delete_mode: next.del, delete_approver_role: next.approver, updated_at: new Date().toISOString() }, { onConflict: 'role,module_slug' })
    setBusyKey(null)
    if (error) {
      setError(`${role} / ${row.label}: ${error.message}`)
      setState(s => { const c = { ...s }; if (before) c[key] = before; else delete c[key]; return c })
      return
    }
    setSavedKey(key)
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1500)
    await bumpShell()
  }

  /** Back to inheriting: the row of its own is removed. */
  async function resetWs(role: Role, row: MatrixRow) {
    const key: Key = `${role}::${row.slug}`
    const before = state[key]
    if (!before) return
    setState(s => { const c = { ...s }; delete c[key]; return c })
    setBusyKey(key); setError(null)
    const { error } = await createClient().from('role_permissions').delete().match({ role, module_slug: row.slug })
    setBusyKey(null)
    if (error) { setError(`${role} / ${row.label}: ${error.message}`); setState(s => ({ ...s, [key]: before })); return }
    setSavedKey(key)
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 1500)
    await bumpShell()
  }

  // Delete rule — cycles none → direct → request; only delete_* columns are written.
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
  const tabCount = allTabSlugs.length
  const pillCount = sections.flatMap(s => s.rows).filter(r => r.kind === 'sub').length

  const rowProps = {
    visibleRoles: orderedRoles, catStart, labels, getCell, hasOwnRow, wsEffective, busyKey, savedKey, hoverRole, hoverSlug,
    setHoverRole, setHoverSlug, toggle, toggleWs, resetWs, cycleDelete, setApprover, cycleDeleteWs, setApproverWs, searching, expanded,
    toggleExpanded: (slug: string) => setExpanded(e => { const n = new Set(e); if (n.has(slug)) n.delete(slug); else n.add(slug); return n }),
  }

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
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 tabular-nums">{tabCount} tabs · {pillCount} pills</span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 tabular-nums">{totalMods} powers</span>
            </span>
            <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-100 text-blue-700"><Eye className="h-2.5 w-2.5" /></span>Open / View</span>
              <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-4 items-center justify-center rounded border border-dashed border-gray-300 text-gray-400"><Eye className="h-2.5 w-2.5" /></span>inherited</span>
              {ACTIONS.slice(1).map(a => (
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
<b>Tabs and pills</b> carry View · Edit · Admin · Delete like a power. A dashed cell inherits — a tab from its power, a pill from its tab; one click gives it a row of its own, <RotateCcw className="inline h-3 w-3 align-text-bottom" /> takes it back. Inside a project the tab’s and pill’s settings are what the screens see. <b>Powers</b> are the base they inherit from and what a write still checks: Edit auto-grants View, Admin auto-grants View + Edit, removing View clears the row; Delete cycles none → direct → needs approval. Admin has full access always.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {canManageRoles && !showAddRole && (
              <Button size="sm" variant="outline" onClick={() => setShowAddRole(true)}>
                <Plus className="h-4 w-4" /> Add role
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(allTabSlugs))} className="text-gray-600">
              <ChevronDown className="h-4 w-4" /> Show every pill
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())} className="text-gray-600">
              <ChevronRight className="h-4 w-4" /> Tabs only
            </Button>
          </div>
          {canManageRoles && showAddRole && (
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

          {/* Matrix */}
          <div className="overflow-auto max-h-[72vh] rounded-xl border border-gray-200" onMouseLeave={() => { setHoverRole(null); setHoverSlug(null) }}>
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
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
                  <th className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-gray-200 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 min-w-[260px]">Tab · pill · power</th>
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
                          {role === ('admin' as Role) ? <span className="text-purple-500 font-semibold">full</span> : <span className="tabular-nums" title="Powers this role holds">{roleModuleCount(role)}/{totalMods}</span>}
                          {busy && <Loader2 className="h-3 w-3 animate-spin text-blue-600" />}
                          {saved && <Check className="h-3 w-3 text-green-600" />}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sections.map(section => <SectionRows key={section.id} section={section} colCount={colCount} {...rowProps} />)}

              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Roles — grouped by category to make setup easier. */}
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

// ─── A section's rows ────────────────────────────────────────────────────
interface RowsProps {
  section: MatrixSection
  colCount: number
  visibleRoles: Role[]
  catStart: Set<string>
  labels: RoleLabelMap
  getCell: (role: Role, slug: string) => CellState
  hasOwnRow: (role: Role, slug: string) => boolean
  wsEffective: (role: Role, row: MatrixRow) => { a: Access; own: boolean; del: Mode; approver: string | null; from: string }
  busyKey: Key | null; savedKey: Key | null
  hoverRole: Role | null; hoverSlug: string | null
  setHoverRole: (r: Role | null) => void; setHoverSlug: (s: string | null) => void
  toggle: (role: Role, slug: string, action: PermAction) => void
  toggleWs: (role: Role, row: MatrixRow, action: PermAction) => void
  resetWs: (role: Role, row: MatrixRow) => void
  cycleDelete: (role: Role, slug: string) => void
  setApprover: (role: Role, slug: string, approver: string | null) => void
  cycleDeleteWs: (role: Role, row: MatrixRow) => void
  setApproverWs: (role: Role, row: MatrixRow, approver: string | null) => void
  searching: boolean
  expanded: Set<string>
  toggleExpanded: (slug: string) => void
}

function SectionRows(p: RowsProps) {
  const { section, colCount, visibleRoles, catStart, labels, getCell, wsEffective, busyKey, savedKey, hoverRole, hoverSlug, setHoverRole, setHoverSlug, toggle, toggleWs, resetWs, cycleDelete, setApprover, cycleDeleteWs, setApproverWs, searching, expanded, toggleExpanded } = p
  const pillsOf = (tabSlugStr: string) => section.rows.filter(r => r.parent === tabSlugStr).length
  return (
    <>
      {section.title && (
        <tr>
          <td colSpan={colCount} className="sticky left-0 bg-white px-3 pt-4 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{section.title}</span>
            {section.note && <p className="text-[11px] text-gray-400 mt-0.5">{section.note}</p>}
          </td>
        </tr>
      )}
      {section.rows.map(row => {
        if (row.kind === 'sub' && !searching && !expanded.has(row.parent ?? '')) return null
        const rowHot = hoverSlug === row.slug
        const isWs = row.kind !== 'module'
        const meta = row.kind === 'module' ? moduleMetaMap.get(row.slug) : undefined
        const tone = meta ? TILE_TONES[meta.tone] : TILE_TONES.slate
        const Icon: React.ComponentType<{ className?: string }> = row.kind === 'tab' ? (TAB_ICONS[row.icon ?? ''] ?? Box) : row.kind === 'module' ? (meta?.icon ?? Box) : ChevronRight
        const nPills = row.kind === 'tab' ? pillsOf(row.slug) : 0
        return (
          <tr key={row.slug} className={cn('group', row.kind === 'sub' && 'bg-slate-50/40')}>
            <td className={cn('sticky left-0 z-10 border-b border-gray-100 py-1.5 transition-colors', row.kind === 'sub' ? 'pl-10 pr-3' : 'px-3', rowHot ? 'bg-indigo-50/60' : row.kind === 'sub' ? 'bg-slate-50/60' : 'bg-white')}>
              <div className="flex items-center gap-2">
                {row.kind === 'tab' && nPills > 0 && !searching ? (
                  <button type="button" onClick={() => toggleExpanded(row.slug)} title={expanded.has(row.slug) ? 'Hide the pills' : `Show the ${nPills} pills`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-800 flex-shrink-0">
                    {expanded.has(row.slug) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                ) : row.kind === 'tab' ? <span className="inline-block h-5 w-5 flex-shrink-0" /> : null}
                {row.kind !== 'sub' && (
                  <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0', row.kind === 'tab' ? 'bg-indigo-50 text-indigo-700' : cn(tone.bg, tone.ic))}><Icon className="h-4 w-4" /></span>
                )}
                <div className="min-w-0">
                  <div className={cn('leading-tight truncate', row.kind === 'sub' ? 'text-[13px] text-gray-800' : 'font-medium text-gray-900')}>
                    {row.label}
                    {row.kind === 'tab' && nPills > 0 && <span className="ml-1.5 text-[11px] font-normal text-gray-400">{nPills} pill{nPills === 1 ? '' : 's'}</span>}
                    {row.reviewerOnly && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 bg-violet-50 rounded px-1 py-0.5">reviewers</span>}
                    {row.unbuilt && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 rounded px-1 py-0.5">coming soon</span>}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate">{row.hint ?? row.slug}</div>
                </div>
              </div>
            </td>
            {visibleRoles.map(role => {
              const k: Key = `${role}::${row.slug}`
              const busy = busyKey === k
              const saved = savedKey === k
              const locked = role === ('admin' as Role)
              const colHot = hoverRole === role
              if (isWs) {
                const eff = locked ? { a: { view: true, edit: true, admin: true }, own: true, del: 'direct' as Mode, approver: null, from: '' } : wsEffective(role, row)
                const level = eff.a.admin ? 'admin' : eff.a.edit ? 'edit' : eff.a.view ? 'view' : 'none'
                const tint = colHot || rowHot ? 'bg-indigo-50/50'
                  : !eff.own ? '' : level === 'admin' ? 'bg-purple-50/50' : level === 'edit' ? 'bg-amber-50/40' : level === 'view' ? 'bg-blue-50/40' : 'bg-rose-50/30'
                const where = eff.own ? 'set here' : eff.from
                return (
                  <td key={role} className={cn('border-b border-gray-100 px-2 py-1.5 text-center transition-colors', tint, catStart.has(role) && 'border-l-2 border-l-slate-200', saved && 'ring-1 ring-inset ring-green-300')}
                    onMouseEnter={() => { setHoverRole(role); setHoverSlug(row.slug) }}>
                    <div className="inline-flex items-center gap-1 align-middle">
                      <div className={cn('inline-flex overflow-hidden rounded-md border divide-x bg-white', eff.own || locked ? 'border-gray-200 divide-gray-200' : 'border-dashed border-gray-300 divide-gray-200')}
                        title={locked ? 'Admin always has full access' : `${where} · click an action to ${eff.own ? 'flip it' : `set it for this ${row.kind === 'tab' ? 'tab' : 'pill'}`}`}>
                        {ACTIONS.map(({ key, label, icon: I, on }) => {
                          const active = eff.a[key]
                          return (
                            <button key={key} onClick={() => { if (!locked) toggleWs(role, row, key) }} disabled={busy || locked}
                              title={locked ? 'Admin always has full access' : `${label}: ${active ? 'allowed' : 'denied'} — ${where}. Click to ${active ? 'remove' : 'allow'}`}
                              className={cn('inline-flex h-6 w-6 items-center justify-center transition-colors', active ? (eff.own || locked ? on : cn(on, 'opacity-60')) : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50', busy && 'opacity-50 cursor-wait', locked && 'cursor-default')}>
                              {busy && key === 'view' ? <Loader2 className="h-3 w-3 animate-spin" /> : key === 'view' && !active ? <EyeOff className="h-3 w-3" /> : <I className="h-3 w-3" />}
                            </button>
                          )
                        })}
                        {(() => {
                          const del: Mode = eff.del
                          const dCls = del === 'direct' ? cn('bg-emerald-100 text-emerald-700', !eff.own && !locked && 'opacity-60')
                            : del === 'request' ? cn('bg-amber-100 text-amber-800', !eff.own && !locked && 'opacity-60')
                            : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'
                          const dTitle = locked ? 'Admin always deletes directly'
                            : `Delete: ${del === 'none' ? 'not allowed' : del === 'direct' ? 'direct' : 'needs approval'} — ${where}. Click to cycle`
                          return (
                            <button onClick={() => { if (!locked) cycleDeleteWs(role, row) }} disabled={busy || locked} title={dTitle}
                              className={cn('inline-flex h-6 w-6 items-center justify-center transition-colors', dCls, busy && 'opacity-50 cursor-wait', locked && 'cursor-default')}>
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )
                        })()}
                      </div>
                      {!locked && eff.own && (
                        <button type="button" onClick={() => resetWs(role, row)} disabled={busy} title={`Back to inheriting (${row.kind === 'tab' ? row.inherits : 'its tab'})`}
                          className="inline-flex h-6 w-5 items-center justify-center rounded text-gray-300 hover:text-gray-700 hover:bg-gray-100">
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {eff.del === 'request' && eff.own && !locked && (
                      <div className="mt-1">
                        <select value={eff.approver ?? ''} onChange={e => setApproverWs(role, row, e.target.value || null)} disabled={busy}
                          title="Who approves a delete request"
                          className="h-6 max-w-[104px] rounded-md border border-amber-300 bg-amber-50 px-1 text-[10px] text-amber-900">
                          <option value="">approver…</option>
                          {visibleRoles.map(r => <option key={r} value={r as string}>{labels[r]?.label || r}</option>)}
                        </select>
                      </div>
                    )}
                  </td>
                )
              }
              const cell = getCell(role, row.slug)
              const level = locked || cell.admin ? 'admin' : cell.edit ? 'edit' : cell.view ? 'view' : 'none'
              const tint = colHot || rowHot ? 'bg-indigo-50/50'
                : level === 'admin' ? 'bg-purple-50/50' : level === 'edit' ? 'bg-amber-50/40' : level === 'view' ? 'bg-blue-50/40' : ''
              return (
                <td key={role} className={cn('border-b border-gray-100 px-2 py-1.5 text-center transition-colors', tint, catStart.has(role) && 'border-l-2 border-l-slate-200', saved && 'ring-1 ring-inset ring-green-300')}
                  onMouseEnter={() => { setHoverRole(role); setHoverSlug(row.slug) }}>
                  <div className="inline-flex overflow-hidden rounded-md border border-gray-200 divide-x divide-gray-200 bg-white align-middle">
                    {ACTIONS.map(({ key, label, icon: I, on }) => {
                      const active = locked ? true : cell[key]
                      return (
                        <button key={key} onClick={() => { if (!locked) toggle(role, row.slug, key) }} disabled={busy || locked}
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
                        <button onClick={() => { if (!locked) cycleDelete(role, row.slug) }} disabled={busy || locked} title={dTitle}
                          className={cn('inline-flex h-6 w-6 items-center justify-center transition-colors', dCls, busy && 'opacity-50 cursor-wait', locked && 'cursor-default')}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )
                    })()}
                  </div>
                  {cell.del === 'request' && !locked && (
                    <div className="mt-1">
                      <select value={cell.approver ?? ''} onChange={e => setApprover(role, row.slug, e.target.value || null)} disabled={busy}
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
        <button type="button" onClick={() => { setL(label); setD(description); setEditing(true) }} title="Rename / edit description"
          className="flex-shrink-0 mt-0.5 h-5 w-5 inline-flex items-center justify-center rounded text-gray-300 group-hover:text-blue-600 hover:bg-blue-50">
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

