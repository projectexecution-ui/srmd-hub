'use client'
import { bumpShell } from '@/lib/shell-actions'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ShieldCheck, ShieldOff, Ban, ArrowDownUp } from 'lucide-react'
import type { Role } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'

// The picker value can be a real role, the literal 'inherit' (no override
// row), or the literal 'block' (a user_module_blocks row). Strings only —
// they're what the dropdown sends back through onChange.
type PickerValue = 'inherit' | 'block' | Role

type Profile = {
  id: string
  full_name: string | null
  email: string
  role: string          // global role
  is_active: boolean | null
}
type Override = { user_id: string; module_slug: string; role: string }
type Block    = { user_id: string; module_slug: string }

interface Props {
  profiles: Profile[]
  overrides: Override[]
  blocks: Block[]
  roleLabels: RoleLabelMap
  canManage: boolean
}

// What we offer in the dropdown. Order matters — most-common at the top.
const ROLE_OPTIONS: { value: PickerValue; group: 'inherit' | 'role' | 'block' }[] = [
  { value: 'inherit',     group: 'inherit' },
  { value: 'admin',       group: 'role' },
  { value: 'head',        group: 'role' },
  { value: 'engineer',    group: 'role' },
  { value: 'site_staff',  group: 'role' },
  { value: 'contractor',  group: 'role' },
  { value: 'viewer',      group: 'role' },
  { value: 'block',       group: 'block' },
]

export function JmrRolesPanel({ profiles, overrides: initialOverrides, blocks: initialBlocks, roleLabels, canManage }: Props) {
  const router = useRouter()
  const [overrides, setOverrides] = useState<Override[]>(initialOverrides)
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const overrideByUser = useMemo(() => new Map(overrides.map(o => [o.user_id, o.role])), [overrides])
  const blockedUsers   = useMemo(() => new Set(blocks.map(b => b.user_id)), [blocks])

  function currentValue(userId: string): PickerValue {
    if (blockedUsers.has(userId)) return 'block'
    const r = overrideByUser.get(userId)
    return (r as Role) ?? 'inherit'
  }

  // Effective JMR role string shown next to the dropdown — the resolved
  // permission the user would actually get on /jmr pages right now.
  function effective(p: Profile): { label: string; tone: 'inherit' | 'override' | 'block' } {
    if (blockedUsers.has(p.id)) return { label: 'Blocked from JMR', tone: 'block' }
    const o = overrideByUser.get(p.id)
    if (o) return { label: roleLabels[o as Role]?.label ?? o, tone: 'override' }
    return { label: roleLabels[p.role as Role]?.label ?? p.role, tone: 'inherit' }
  }

  async function setPick(userId: string, newValue: PickerValue) {
    setBusyId(userId); setError(null)
    const supabase = createClient()

    // Cleanest semantics — every change resolves to "(remove old) → (add new)"
    // so we never end up with both an override AND a block.
    // 1. Wipe both
    const [delOverride, delBlock] = await Promise.all([
      supabase.from('user_module_roles').delete().eq('user_id', userId).eq('module_slug', 'jmr-admin'),
      supabase.from('user_module_blocks').delete().eq('user_id', userId).eq('module_slug', 'jmr-admin'),
    ])
    if (delOverride.error) { setBusyId(null); setError(delOverride.error.message); return }
    if (delBlock.error)    { setBusyId(null); setError(delBlock.error.message);    return }

    // 2. Insert the new shape if non-inherit
    if (newValue === 'block') {
      const { error } = await supabase
        .from('user_module_blocks')
        .insert({ user_id: userId, module_slug: 'jmr-admin' })
      if (error) { setBusyId(null); setError(error.message); return }
      setBlocks(prev => [...prev.filter(b => b.user_id !== userId), { user_id: userId, module_slug: 'jmr-admin' }])
      setOverrides(prev => prev.filter(o => o.user_id !== userId))
    } else if (newValue !== 'inherit') {
      const { error } = await supabase
        .from('user_module_roles')
        .insert({ user_id: userId, module_slug: 'jmr-admin', role: newValue })
      if (error) { setBusyId(null); setError(error.message); return }
      setOverrides(prev => [...prev.filter(o => o.user_id !== userId), { user_id: userId, module_slug: 'jmr-admin', role: newValue }])
      setBlocks(prev => prev.filter(b => b.user_id !== userId))
    } else {
      // 'inherit' — already cleared both
      setOverrides(prev => prev.filter(o => o.user_id !== userId))
      setBlocks(prev    => prev.filter(b => b.user_id !== userId))
    }

    setBusyId(null)
    await bumpShell()
    router.refresh()
  }

  const filtered = profiles.filter(p => {
    if (!query) return true
    const q = query.toLowerCase()
    return (p.full_name?.toLowerCase().includes(q) ?? false) || p.email.toLowerCase().includes(q)
  })

  return (
    <div>
      {error && (
        <div className="px-4 py-2 bg-rose-50 text-rose-700 text-xs border-b border-rose-100">{error}</div>
      )}

      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name or email"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">User</th>
            <th className="px-4 py-2 text-left font-semibold">Hub role</th>
            <th className="px-4 py-2 text-left font-semibold">JMR role override</th>
            <th className="px-4 py-2 text-left font-semibold">Effective in JMR</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(p => {
            const eff = effective(p)
            const cur = currentValue(p.id)
            const isBusy = busyId === p.id
            return (
              <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.full_name || p.email}</p>
                  <p className="text-xs text-gray-500 truncate">{p.email}</p>
                </td>
                <td className="px-4 py-2">
                  <span className="text-xs font-medium text-gray-700">{roleLabels[p.role as Role]?.label ?? p.role}</span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={cur}
                      disabled={!canManage || isBusy}
                      onChange={e => setPick(p.id, e.target.value as PickerValue)}
                      className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 disabled:bg-gray-50"
                    >
                      <option value="inherit">— Inherit hub role —</option>
                      <optgroup label="Override JMR role">
                        {ROLE_OPTIONS.filter(o => o.group === 'role').map(o => (
                          <option key={o.value} value={o.value}>{roleLabels[o.value as Role]?.label ?? o.value}</option>
                        ))}
                      </optgroup>
                      <option value="block">Block from JMR</option>
                    </select>
                    {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <EffectiveChip label={eff.label} tone={eff.tone} />
                </td>
              </tr>
            )
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-xs text-gray-500 text-center italic">
                {query ? 'No users match.' : 'No active users yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function EffectiveChip({ label, tone }: { label: string; tone: 'inherit' | 'override' | 'block' }) {
  const cls = tone === 'block'
    ? 'bg-rose-50 text-rose-700'
    : tone === 'override'
      ? 'bg-blue-50 text-blue-700'
      : 'bg-gray-100 text-gray-600'
  const icon = tone === 'block'
    ? <Ban className="h-3 w-3" />
    : tone === 'override'
      ? <ShieldCheck className="h-3 w-3" />
      : <ArrowDownUp className="h-3 w-3" />
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${cls}`}>
      {icon}
      {label}
      {tone === 'inherit' && <span className="text-gray-400 ml-0.5 text-[10px]">(inherited)</span>}
    </span>
  )
}

// Re-exported so existing imports `import { AdminsPanel } from './admins-panel'`
// keep working without churn while the canonical name is `JmrRolesPanel`.
export { JmrRolesPanel as AdminsPanel }
// Suppress unused-import warning — ShieldOff icon now lives in confirm-dialog flows only.
void ShieldOff
