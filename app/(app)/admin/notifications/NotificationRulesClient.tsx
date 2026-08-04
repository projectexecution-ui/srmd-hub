'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Bell, Mail, Smartphone, Lock, Clock, Info, Loader2, ChevronDown, ChevronRight, Users2, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Role } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'
import { NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS, builtInDefault } from '@/lib/notification-events'
import type { NotificationRuleRow } from './page'

const keyOf = (scope: string, scopeKey: string, event: string, channel: string) =>
  `${scope}|${scopeKey}|${event}|${channel}`

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  in_app: <Bell className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  web_push: <Smartphone className="h-3.5 w-3.5" />,
}

// Approvals moving through the chain must always notify — locked on, can't
// be switched off here. (Individuals still can't silence these either.)
const PINNED_EVENTS = new Set(['approval_pending'])

export interface NotificationScheduleRow { scope: string; scope_key: string; event_type: string; mode: string }
// "Daily digest" was removed 2026-08-04 — it deferred emails (including ones
// that were already daily summaries) and they got stuck unsent. Everything is
// Instant now; per-event muting is Off. On/off per channel lives in the grid above.
const TIMING_MODES = [
  { key: 'instant', label: 'Instant' },
  { key: 'off', label: 'Off' },
] as const

export default function NotificationRulesClient({
  initialRules, initialSchedules = [], roles, roleLabels, currentUserId,
}: {
  initialRules: NotificationRuleRow[]
  initialSchedules?: NotificationScheduleRow[]
  roles: Role[]
  roleLabels: RoleLabelMap
  currentUserId: string
}) {
  const supabase = createClient()
  const [rules, setRules] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    for (const r of initialRules) m[keyOf(r.scope, r.scope_key, r.event_type, r.channel)] = r.enabled
    return m
  })
  const [schedules, setSchedules] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const s of initialSchedules) m[`${s.scope}|${s.scope_key}|${s.event_type}`] = s.mode
    return m
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openRole, setOpenRole] = useState<Role | null>(null)

  // ── delivery timing (per type, org-wide) ──────────
  const globalMode = (event: string) => schedules[`global||${event}`] ?? 'instant'
  async function setMode(event: string, mode: string) {
    const k = `mode:${event}`
    setBusy(k); setError(null)
    const { error } = await supabase.from('notification_schedule').upsert(
      { scope: 'global', scope_key: '', event_type: event, mode, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'scope,scope_key,event_type' },
    )
    setBusy(null)
    if (error) { setError(error.message); return }
    setSchedules(p => ({ ...p, [`global||${event}`]: mode }))
  }

  // ── value resolution ──────────────────────────────
  const globalVal = (event: string, channel: string) => {
    const k = keyOf('global', '', event, channel)
    return k in rules ? rules[k] : builtInDefault(channel)
  }
  const roleVal = (role: string, event: string, channel: string) => {
    const k = keyOf('role', role, event, channel)
    return k in rules ? rules[k] : globalVal(event, channel)
  }
  const roleOverridden = (role: string) =>
    Object.keys(rules).some(k => k.startsWith(`role|${role}|`))

  // ── writes ────────────────────────────────────────
  async function upsertRule(scope: string, scopeKey: string, event: string, channel: string, enabled: boolean) {
    const k = keyOf(scope, scopeKey, event, channel)
    setBusy(k); setError(null)
    const { error } = await supabase.from('notification_rules').upsert(
      { scope, scope_key: scopeKey, event_type: event, channel, enabled, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'scope,scope_key,event_type,channel' },
    )
    setBusy(null)
    if (error) { setError(error.message); return }
    setRules(p => ({ ...p, [k]: enabled }))
  }

  async function enableRoleOverride(role: string) {
    setBusy(`role:${role}`); setError(null)
    // Seed the role's rules from the current org-default values so the grid
    // starts matching what that role gets today; the admin then tweaks.
    const rows = NOTIFICATION_EVENTS.flatMap(e =>
      NOTIFICATION_CHANNELS.map(c => ({
        scope: 'role', scope_key: role, event_type: e.type, channel: c.key,
        enabled: globalVal(e.type, c.key), updated_by: currentUserId,
      })),
    )
    const { error } = await supabase.from('notification_rules').upsert(rows, { onConflict: 'scope,scope_key,event_type,channel' })
    setBusy(null)
    if (error) { setError(error.message); return }
    setRules(p => {
      const n = { ...p }
      for (const r of rows) n[keyOf('role', role, r.event_type, r.channel)] = r.enabled
      return n
    })
    setOpenRole(role as Role)
  }

  async function disableRoleOverride(role: string) {
    setBusy(`role:${role}`); setError(null)
    const { error } = await supabase.from('notification_rules').delete().eq('scope', 'role').eq('scope_key', role)
    setBusy(null)
    if (error) { setError(error.message); return }
    setRules(p => {
      const n = { ...p }
      for (const k of Object.keys(n)) if (k.startsWith(`role|${role}|`)) delete n[k]
      return n
    })
    if (openRole === role) setOpenRole(null)
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Notifications"
        back="/admin"
        subtitle="Decide which alerts your team gets, and on which channel."
      />

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-4 pb-4 text-xs text-blue-900 leading-relaxed">
          <p className="font-semibold mb-1 flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> How this works</p>
          <p>
            The <b>org default</b> below applies to everyone. You can <b>override per role</b> for exceptions
            (e.g. only Admins get emails). On top of that, each person can still mute channels for themselves on
            their own <b>Notification settings</b> page. Order of priority: <b>user&apos;s own choice → role override → org default</b>.
          </p>
        </CardContent>
      </Card>

      {/* ── Org default ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-5 w-5 text-blue-600" />
            Org default — applies to everyone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RuleGrid
            value={(event, channel) => globalVal(event, channel)}
            onToggle={(event, channel, next) => upsertRule('global', '', event, channel, next)}
            busy={busy}
            busyKeyFor={(event, channel) => keyOf('global', '', event, channel)}
          />
        </CardContent>
      </Card>

      {/* ── Delivery timing ─────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-5 w-5 text-blue-600" />
            When each alert is delivered
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-500 mb-3">
            <b>Instant</b> = sent the moment it happens. <b>Off</b> = no email/phone for this alert
            (it still shows in the bell). Approvals are always Instant.
          </p>
          <div className="divide-y divide-gray-100">
            {NOTIFICATION_EVENTS.map(e => {
              const locked = PINNED_EVENTS.has(e.type)
              const cur = locked ? 'instant' : globalMode(e.type)
              const rowBusy = busy === `mode:${e.type}`
              return (
                <div key={e.type} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                      {e.label}
                      {locked && <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-0.5"><Lock className="h-2.5 w-2.5" /> Instant</span>}
                    </p>
                  </div>
                  <div className={cn('inline-flex rounded-lg border border-gray-200 overflow-hidden flex-shrink-0', rowBusy && 'opacity-60')}>
                    {TIMING_MODES.map(m => (
                      <button
                        key={m.key}
                        type="button"
                        disabled={locked || rowBusy}
                        aria-pressed={cur === m.key}
                        onClick={() => { if (!locked) setMode(e.type, m.key) }}
                        className={cn(
                          'text-xs font-semibold px-3 py-1.5 border-r border-gray-200 last:border-r-0 transition-colors',
                          cur === m.key ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50',
                          (locked || rowBusy) && 'cursor-not-allowed',
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Per-role overrides ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users2 className="h-5 w-5 text-slate-600" />
            Per-role overrides <span className="text-xs font-normal text-gray-400">(optional)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-xs text-gray-500 mb-2">
            Most roles can just follow the org default. Turn on an override only when a role needs something different.
          </p>
          {roles.map(role => {
            const overridden = roleOverridden(role)
            const open = openRole === role
            const roleBusy = busy === `role:${role}`
            return (
              <div key={role} className="border-b border-gray-100 last:border-0">
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpenRole(open ? null : role)}
                    className="flex items-center gap-2 min-w-0 text-left"
                  >
                    {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                    <span className="text-sm font-medium text-gray-900">{roleLabels[role]?.label ?? role}</span>
                    {overridden
                      ? <Badge variant="default" className="text-[10px]">Custom</Badge>
                      : <Badge variant="secondary" className="text-[10px]">Follows org default</Badge>}
                  </button>
                  <button
                    type="button"
                    disabled={roleBusy}
                    onClick={() => (overridden ? disableRoleOverride(role) : enableRoleOverride(role))}
                    className={cn(
                      'text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex-shrink-0',
                      overridden
                        ? 'text-rose-600 border-rose-200 hover:bg-rose-50'
                        : 'text-blue-700 border-blue-200 hover:bg-blue-50',
                      roleBusy && 'opacity-50',
                    )}
                  >
                    {roleBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : overridden ? 'Remove override' : 'Override'}
                  </button>
                </div>
                {open && overridden && (
                  <div className="pb-3 pl-6">
                    <RuleGrid
                      value={(event, channel) => roleVal(role, event, channel)}
                      onToggle={(event, channel, next) => upsertRule('role', role, event, channel, next)}
                      busy={busy}
                      busyKeyFor={(event, channel) => keyOf('role', role, event, channel)}
                    />
                  </div>
                )}
                {open && !overridden && (
                  <p className="pb-3 pl-6 text-xs text-gray-400">
                    This role follows the org default. Click <b>Override</b> to set its own.
                  </p>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

// ── reusable event × channel grid of switches ──────────────────
function RuleGrid({
  value, onToggle, busy, busyKeyFor,
}: {
  value: (event: string, channel: string) => boolean
  onToggle: (event: string, channel: string, next: boolean) => void
  busy: string | null
  busyKeyFor: (event: string, channel: string) => string
}) {
  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-[20rem] grid gap-x-5 gap-y-3 items-center"
        style={{ gridTemplateColumns: `minmax(11rem,1fr) ${'auto '.repeat(NOTIFICATION_CHANNELS.length).trim()}` }}
      >
        {/* header */}
        <div />
        {NOTIFICATION_CHANNELS.map(c => (
          <div key={c.key} className="flex items-center justify-center gap-1 text-xs font-semibold text-gray-600" title={c.help}>
            {CHANNEL_ICON[c.key]}{c.label}
          </div>
        ))}
        {/* rows */}
        {NOTIFICATION_EVENTS.map(e => (
          <RuleRow key={e.type} event={e} value={value} onToggle={onToggle} busy={busy} busyKeyFor={busyKeyFor} />
        ))}
      </div>
    </div>
  )
}

function RuleRow({
  event, value, onToggle, busy, busyKeyFor,
}: {
  event: { type: string; label: string; description: string; audience: string }
  value: (event: string, channel: string) => boolean
  onToggle: (event: string, channel: string, next: boolean) => void
  busy: string | null
  busyKeyFor: (event: string, channel: string) => string
}) {
  const locked = PINNED_EVENTS.has(event.type)
  return (
    <>
      <div className="min-w-0 py-1">
        <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
          {event.label}
          {locked && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-0.5" title="Approvals always notify — this can't be turned off">
              <Lock className="h-2.5 w-2.5" /> Always on
            </span>
          )}
        </p>
        <p className="text-[11px] text-gray-500 leading-tight">{event.description}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">→ {event.audience}</p>
      </div>
      {NOTIFICATION_CHANNELS.map(c => {
        const on = locked ? true : value(event.type, c.key)
        const k = busyKeyFor(event.type, c.key)
        const isBusy = busy === k
        return (
          <div key={c.key} className="flex items-center justify-center">
            <Switch on={on} busy={isBusy} locked={locked} onClick={() => { if (!locked) onToggle(event.type, c.key, !on) }} />
          </div>
        )
      })}
    </>
  )
}

function Switch({ on, busy, onClick, locked = false }: { on: boolean; busy: boolean; onClick: () => void; locked?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy || locked}
      onClick={onClick}
      title={locked ? "Approvals always notify — can't be turned off" : undefined}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0',
        on ? 'bg-blue-600' : 'bg-gray-300',
        busy && 'opacity-60',
        locked && 'opacity-70 cursor-not-allowed',
      )}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin text-white mx-auto" />
      ) : (
        <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
      )}
    </button>
  )
}
