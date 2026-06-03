'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Loader2, ShieldCheck, ShieldOff, UserPlus, Lock } from 'lucide-react'

type Profile = {
  id: string
  full_name: string | null
  email: string
  role: string
  is_active: boolean | null
}
type Override = {
  user_id: string
  module_slug: string
  role: string
}

interface Props {
  profiles: Profile[]
  overrides: Override[]
  /** False for read-only viewers (head, etc.) — they see the list but can't toggle. */
  canManage: boolean
}

export function AdminsPanel({ profiles, overrides: initialOverrides, canManage }: Props) {
  const router = useRouter()
  const [overrides, setOverrides] = useState<Override[]>(initialOverrides)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  const overrideUserIds = useMemo(() => new Set(overrides.map(o => o.user_id)), [overrides])

  // Three buckets — global admins (auto), override admins (revocable), non-admins (pickable).
  const globalAdmins = profiles.filter(p => p.role === 'admin')
  const overrideAdmins = profiles.filter(p => p.role !== 'admin' && overrideUserIds.has(p.id))
  const candidates = profiles.filter(p => p.role !== 'admin' && !overrideUserIds.has(p.id))

  const filteredCandidates = candidates.filter(p => {
    if (!pickerQuery) return true
    const q = pickerQuery.toLowerCase()
    return (p.full_name?.toLowerCase().includes(q) ?? false) || p.email.toLowerCase().includes(q)
  })

  async function promote(userId: string) {
    setBusyId(userId); setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('user_module_roles')
      .upsert(
        { user_id: userId, module_slug: 'jmr-admin', role: 'admin' },
        { onConflict: 'user_id,module_slug' }
      )
    setBusyId(null)
    if (error) { setError(error.message); return }
    setOverrides(prev => [...prev, { user_id: userId, module_slug: 'jmr-admin', role: 'admin' }])
    setPickerOpen(false)
    setPickerQuery('')
    router.refresh()
  }

  async function revoke(userId: string, label: string) {
    if (!confirm(`Revoke JMR admin from "${label}"?\n\nThey will keep their global role but lose access to JMR Admin pages (Projects, Contractors, Items, Rate Cards, etc.) and lose approve/flag rights.`)) return
    setBusyId(userId); setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('user_module_roles')
      .delete()
      .eq('user_id', userId)
      .eq('module_slug', 'jmr-admin')
    setBusyId(null)
    if (error) { setError(error.message); return }
    setOverrides(prev => prev.filter(o => o.user_id !== userId))
    router.refresh()
  }

  return (
    <div className="divide-y divide-gray-100">
      {error && (
        <div className="px-4 py-2 bg-rose-50 text-rose-700 text-xs border-b border-rose-100">{error}</div>
      )}

      {/* Global admins — always have JMR admin. Locked here. */}
      <Section
        title="Global admins"
        subtitle="Have JMR admin automatically because their global role is Admin"
      >
        {globalAdmins.length === 0 ? (
          <Empty>No global admins.</Empty>
        ) : (
          globalAdmins.map(p => (
            <Row
              key={p.id}
              name={p.full_name || p.email}
              email={p.email}
              chip={<Chip tone="emerald" icon={<ShieldCheck className="h-3 w-3" />}>Auto admin</Chip>}
              action={
                <span className="inline-flex items-center gap-1 text-xs text-gray-400" title="Demote at Admin → Users">
                  <Lock className="h-3 w-3" /> global role
                </span>
              }
            />
          ))
        )}
      </Section>

      {/* Override admins — promoted via this panel, revocable here. */}
      <Section
        title="JMR-only admins"
        subtitle="Granted JMR admin via this panel — keeps their global role unchanged"
      >
        {overrideAdmins.length === 0 ? (
          <Empty>No JMR-only admins yet.</Empty>
        ) : (
          overrideAdmins.map(p => (
            <Row
              key={p.id}
              name={p.full_name || p.email}
              email={p.email}
              chip={<Chip tone="blue" icon={<ShieldCheck className="h-3 w-3" />}>JMR admin</Chip>}
              subtext={`global role: ${p.role}`}
              action={
                canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === p.id}
                    onClick={() => revoke(p.id, p.full_name || p.email)}
                  >
                    {busyId === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldOff className="h-3.5 w-3.5 text-rose-600" />
                    )}
                    <span className="ml-1">Revoke</span>
                  </Button>
                ) : null
              }
            />
          ))
        )}
      </Section>

      {/* Picker — add a new JMR admin. */}
      {canManage && (
        <div className="px-4 py-4">
          {!pickerOpen ? (
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Make someone a JMR admin
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Pick a user to grant JMR admin</p>
                <button
                  type="button"
                  onClick={() => { setPickerOpen(false); setPickerQuery('') }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
              <input
                type="text"
                value={pickerQuery}
                onChange={e => setPickerQuery(e.target.value)}
                placeholder="Search by name or email"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-md divide-y divide-gray-100">
                {filteredCandidates.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-gray-500 text-center">
                    {pickerQuery ? 'No users match.' : 'Everyone is already a JMR admin.'}
                  </p>
                ) : (
                  filteredCandidates.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => promote(p.id)}
                      className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 disabled:opacity-50 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.full_name || p.email}</p>
                        <p className="text-xs text-gray-500 truncate">{p.email} · {p.role}</p>
                      </div>
                      {busyId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                      ) : (
                        <span className="text-xs font-semibold text-blue-700">Grant →</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tiny presentation primitives, scoped to this file ───────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-600">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="divide-y divide-gray-50">
        {children}
      </div>
    </div>
  )
}

function Row({ name, email, chip, subtext, action }: {
  name: string; email: string; chip?: React.ReactNode; subtext?: string; action?: React.ReactNode
}) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
          {chip}
        </div>
        <p className="text-xs text-gray-500 truncate">
          {email}{subtext ? ` · ${subtext}` : ''}
        </p>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-xs text-gray-500 italic">{children}</p>
}

function Chip({ children, tone, icon }: { children: React.ReactNode; tone: 'emerald' | 'blue'; icon?: React.ReactNode }) {
  const cls = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700'
    : 'bg-blue-50 text-blue-700'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {icon}
      {children}
    </span>
  )
}
