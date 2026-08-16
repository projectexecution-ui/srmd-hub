'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Check, ChevronDown, ChevronRight, Mail, Send, Users, MailCheck, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { confirm } from '@/components/ui/confirm-dialog'
import type { ProcurementNotifyConfig, NotifyFrequency } from '@/lib/procurement/notify-settings'

interface UserOpt { id: string; full_name: string | null; email: string; role: string }

const FREQ_LABELS: Record<NotifyFrequency, string> = {
  weekdays: 'Every weekday (Mon–Sat)',
  daily: 'Every day',
  on_upload: 'Only on days an upload happened',
  weekly: 'Weekly',
}

export function ProcurementNotifySettingsForm({
  initial, users, projects,
}: { initial: ProcurementNotifyConfig; users: UserOpt[]; projects: string[] }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [frequency, setFrequency] = useState<NotifyFrequency>(initial.frequency)
  const [noPo, setNoPo] = useState(initial.noPoSlaDays)
  const [grn, setGrn] = useState(initial.grnSlaDays)
  const [sections, setSections] = useState(initial.sections)
  const [assign, setAssign] = useState<Record<string, string[]>>(initial.assignments)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(false)
  const [testing, setTesting] = useState(false)
  const [sendingHeads, setSendingHeads] = useState(false)
  const [tgTesting, setTgTesting] = useState(false)

  const nameOf = (u: UserOpt) => u.full_name || u.email
  const assignedUsers = useMemo(() => users.filter(u => (assign[u.id]?.length ?? 0) > 0), [users, assign])
  const totalAssigned = Object.values(assign).reduce((s, a) => s + a.length, 0)

  function toggleProject(uid: string, proj: string) {
    setAssign(a => {
      const cur = new Set(a[uid] ?? [])
      if (cur.has(proj)) cur.delete(proj); else cur.add(proj)
      return { ...a, [uid]: [...cur] }
    })
  }

  async function save() {
    setSaving(true)
    const clean: Record<string, string[]> = {}
    for (const [uid, projs] of Object.entries(assign)) if (projs.length) clean[uid] = projs
    const rows = [
      { key: 'procurement_notify_enabled', value: String(enabled) },
      { key: 'procurement_notify_frequency', value: frequency },
      { key: 'procurement_notify_no_po_sla_days', value: String(noPo) },
      { key: 'procurement_notify_grn_sla_days', value: String(grn) },
      { key: 'procurement_notify_sections', value: JSON.stringify(sections) },
      { key: 'procurement_notify_assignments', value: JSON.stringify(clean) },
    ]
    const { error } = await createClient().from('app_settings').upsert(rows, { onConflict: 'key' })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    setSavedAt(true); setTimeout(() => setSavedAt(false), 1800)
    toast.success('Saved')
    router.refresh()
  }

  async function sendTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/cron/procurement-digest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await res.json()
      if (!res.ok || j.ok === false) { toast.error(j.reason || j.error || 'Could not send test'); return }
      if (!j.connected) toast.success('Test sent to your email. Connect your Telegram in Settings → Notifications to also get it there.')
      else if (!j.telegramOn) toast.success('Test sent to your email. Your Telegram is OFF in Settings → Notifications — turn it on to get it there.')
      else toast.success('Test sent — it will arrive in your email and Telegram in a few seconds.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally { setTesting(false) }
  }

  async function sendToHeads() {
    if (assignedUsers.length === 0) { toast.error('No head has any project assigned yet.'); return }
    const names = assignedUsers.map(nameOf).join(', ')
    const ok = await confirm({
      title: 'Send the follow-up email now?',
      message: `This emails the digest right now to: ${names}. Each head only sees their own projects. Continue?`,
      confirmLabel: 'Send now',
      danger: false,
    })
    if (!ok) return
    setSendingHeads(true)
    try {
      const res = await fetch('/api/cron/procurement-digest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ toHeads: true }),
      })
      const j = await res.json()
      if (!res.ok || j.ok === false) { toast.error(j.reason || j.error || 'Could not send'); return }
      const sentTo: string[] = j.sentTo ?? []
      const skipped: string[] = j.skipped ?? []
      if (sentTo.length > 0) toast.success(`Sent to ${sentTo.join(', ')}${skipped.length ? ` · nothing to report for ${skipped.join(', ')}` : ''}`)
      else toast.message(`Nothing to report right now for ${skipped.join(', ') || 'any head'} — no email sent.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally { setSendingHeads(false) }
  }

  async function testTelegram() {
    if (assignedUsers.length === 0) { toast.error('No head has any project assigned yet.'); return }
    setTgTesting(true)
    try {
      const res = await fetch('/api/cron/procurement-digest', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ telegramTest: true, to: 'heads' }),
      })
      const j = await res.json()
      if (!res.ok || j.ok === false) { toast.error(j.reason || j.error || 'Could not send Telegram test'); return }
      const connected: string[] = j.connected ?? []
      const notConnected: string[] = j.notConnected ?? []
      const failed: string[] = j.failed ?? []
      if (connected.length > 0) {
        const parts = [`Telegram test delivered to ${connected.join(', ')}`]
        if (notConnected.length) parts.push(`not connected: ${notConnected.join(', ')}`)
        if (failed.length) parts.push(`failed: ${failed.join(', ')}`)
        toast.success(parts.join(' · '))
      } else if (notConnected.length > 0) {
        toast.message(`No head has connected Telegram yet: ${notConnected.join(', ')}. Ask them to link it at Settings → Notifications.`)
      } else {
        toast.error(failed.length ? `All sends failed — ${failed[0]}` : 'Nobody to test.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally { setTgTesting(false) }
  }

  return (
    <Card className="p-4 md:p-5 space-y-5">
      {/* Header + master toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Mail className="h-4 w-4 text-orange-700" /> Daily follow-up email</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-lg">
            Each Atm Head gets one weekday reminder covering <b>only their projects</b> — POs to raise (no PO {noPo}+ days after indent) and deliveries to chase (not received {grn}+ days after PO). Cumulative, so it never floods the inbox.
          </p>
        </div>
        <button
          type="button" onClick={() => setEnabled(v => !v)}
          title={enabled ? 'On — turn off' : 'Off — turn on'}
          className={cn('relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors', enabled ? 'bg-emerald-500' : 'bg-gray-300')}
        >
          <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', enabled ? 'translate-x-6' : 'translate-x-1')} />
        </button>
      </div>

      {/* Frequency + SLAs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-xs">
          <span className="font-semibold text-gray-600">Frequency</span>
          <select value={frequency} onChange={e => setFrequency(e.target.value as NotifyFrequency)}
            className="mt-1 w-full h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm">
            {(Object.keys(FREQ_LABELS) as NotifyFrequency[]).map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-semibold text-gray-600">Raise-PO reminder after</span>
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={0} value={noPo} onChange={e => setNoPo(Math.max(0, Number(e.target.value)))}
              className="w-full h-9 rounded-lg border border-gray-300 px-2 text-sm" />
            <span className="text-gray-500">days</span>
          </div>
        </label>
        <label className="text-xs">
          <span className="font-semibold text-gray-600">Chase-GRN reminder after</span>
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={0} value={grn} onChange={e => setGrn(Math.max(0, Number(e.target.value)))}
              className="w-full h-9 rounded-lg border border-gray-300 px-2 text-sm" />
            <span className="text-gray-500">days</span>
          </div>
        </label>
      </div>

      {/* Sections */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">Include in the email</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {([
            ['needsPo', 'POs to raise'], ['awaiting', 'Deliveries to chase'],
            ['changes', "What changed since yesterday"], ['staleAlert', 'Alert if upload missed'],
          ] as const).map(([k, label]) => (
            <label key={k} className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={sections[k]} onChange={e => setSections(s => ({ ...s, [k]: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Head → projects */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Atm Head → projects <span className="font-normal text-gray-400">· {assignedUsers.length} head{assignedUsers.length === 1 ? '' : 's'} · {totalAssigned} project link{totalAssigned === 1 ? '' : 's'}</span>
        </p>
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-80 overflow-auto">
          {users.map(u => {
            const mine = assign[u.id] ?? []
            const open = expanded === u.id
            return (
              <div key={u.id}>
                <button type="button" onClick={() => setExpanded(open ? null : u.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-gray-900">{nameOf(u)}</span>
                    <span className="text-[11px] text-gray-400 ml-2">{u.role}</span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    {mine.length > 0
                      ? <span className="text-[11px] font-semibold text-orange-700 bg-orange-50 rounded-full px-2 py-0.5">{mine.length} project{mine.length === 1 ? '' : 's'}</span>
                      : <span className="text-[11px] text-gray-400">no projects</span>}
                    {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                  </span>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 bg-gray-50/60">
                    {projects.length === 0 && <p className="text-xs text-gray-400 col-span-2">No projects seen yet — upload an export first.</p>}
                    {projects.map(p => (
                      <label key={p} className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer py-0.5">
                        <input type="checkbox" checked={mine.includes(p)} onChange={() => toggleProject(u.id, p)}
                          className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                        <span className="truncate">{p}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">Tick a project under two heads to co-head it. A head with no projects gets no email.</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button onClick={save} disabled={saving} className="bg-orange-700 hover:bg-orange-800">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : savedAt ? <Check className="h-4 w-4" /> : null}
          {savedAt ? 'Saved' : 'Save'}
        </Button>
        <Button variant="outline" onClick={sendTest} disabled={testing} title="Send yourself a preview of the digest right now">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send me a test
        </Button>
        <Button variant="outline" onClick={sendToHeads} disabled={sendingHeads || assignedUsers.length === 0}
          className="border-emerald-300 text-emerald-800 hover:bg-emerald-50"
          title="Email the digest to the assigned heads right now">
          {sendingHeads ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
          Send to the heads now
        </Button>
        <Button variant="outline" onClick={testTelegram} disabled={tgTesting || assignedUsers.length === 0}
          className="border-sky-300 text-sky-800 hover:bg-sky-50"
          title="Send a quick Telegram test to each assigned head's DM to see who's connected">
          {tgTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
          Test Telegram
        </Button>
        {!enabled && <span className="text-xs text-gray-400">Currently off — nothing goes out until you turn it on and Save.</span>}
      </div>
      <p className="text-[11px] text-gray-400 -mt-3">
        Reminders reach each head by <b className="font-medium text-gray-600">email</b> and, if they’ve linked it, <b className="font-medium text-gray-600">Telegram DM</b> (Settings → Notifications). <b className="font-medium text-gray-600">Test Telegram</b> pings the assigned heads’ DMs so you can see who’s connected.
      </p>
    </Card>
  )
}
