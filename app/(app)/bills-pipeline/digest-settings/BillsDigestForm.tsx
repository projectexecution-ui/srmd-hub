'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Check, Mail, Send, MailCheck, Users, ChevronDown, ChevronRight, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { confirm } from '@/components/ui/confirm-dialog'
import type { BillsDigestConfig } from '@/lib/bills-pipeline/digest-settings'

interface UserOpt { id: string; full_name: string | null; email: string; role: string }

const stageLabel = (s: string) => s.replace(/^Under:\s*/i, '')

export function BillsDigestForm({
  initial, users, projectOptions, availableStages,
}: { initial: BillsDigestConfig; users: UserOpt[]; projectOptions: Array<{ code: string; label: string }>; availableStages: string[] }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [assign, setAssign] = useState<Record<string, string[]>>(initial.assignments)
  const [cc, setCc] = useState<string[]>(initial.cc)
  const [stages, setStages] = useState<Record<string, string[]>>(initial.stages)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(false)
  const [testing, setTesting] = useState(false)
  const [sendingHeads, setSendingHeads] = useState(false)
  const [tgTesting, setTgTesting] = useState(false)

  const nameOf = (u: UserOpt) => u.full_name || u.email
  const assignedUsers = useMemo(() => users.filter(u => (assign[u.id]?.length ?? 0) > 0), [users, assign])
  const totalAssigned = Object.values(assign).reduce((s, a) => s + a.length, 0)

  function toggleProject(uid: string, code: string) {
    setAssign(a => {
      const cur = new Set(a[uid] ?? [])
      if (cur.has(code)) cur.delete(code); else cur.add(code)
      return { ...a, [uid]: [...cur] }
    })
  }
  function toggleCc(uid: string) {
    setCc(c => c.includes(uid) ? c.filter(x => x !== uid) : [...c, uid])
  }
  function toggleStage(uid: string, stage: string) {
    setStages(s => {
      const cur = new Set(s[uid] ?? [])
      if (cur.has(stage)) cur.delete(stage); else cur.add(stage)
      return { ...s, [uid]: [...cur] }
    })
  }

  async function save() {
    setSaving(true)
    const clean: Record<string, string[]> = {}
    for (const [uid, codes] of Object.entries(assign)) if (codes.length) clean[uid] = codes
    const cleanStages: Record<string, string[]> = {}
    for (const [uid, ss] of Object.entries(stages)) if (ss.length) cleanStages[uid] = ss
    const rows = [
      { key: 'bills_digest_enabled', value: String(enabled) },
      { key: 'bills_digest_assignments', value: JSON.stringify(clean) },
      { key: 'bills_digest_cc', value: JSON.stringify(cc) },
      { key: 'bills_digest_stages', value: JSON.stringify(cleanStages) },
    ]
    const { error } = await createClient().from('app_settings').upsert(rows, { onConflict: 'key' })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    setSavedAt(true); setTimeout(() => setSavedAt(false), 1800)
    toast.success('Saved'); router.refresh()
  }

  async function sendTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/cron/bills-digest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await res.json()
      if (!res.ok || j.ok === false) { toast.error(j.reason || j.emailErr || j.error || 'Could not send test'); return }
      const bits: string[] = []
      if (j.email) bits.push('email')
      if (j.telegram) bits.push('Telegram')
      if (bits.length) {
        const tail = !j.connected ? ' · connect Telegram in Settings → Notifications to also get it there'
          : (!j.telegram ? ` · Telegram failed: ${j.telegramErr || 'send failed'}` : '')
        toast.success(`Test sent to your ${bits.join(' + ')}${tail}`)
      } else {
        toast.error(j.emailErr ? `Email failed: ${j.emailErr}` : 'Could not send the test.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally { setTesting(false) }
  }

  async function sendToHeads() {
    if (assignedUsers.length === 0) { toast.error('Assign at least one head to a project first.'); return }
    const names = assignedUsers.map(nameOf).join(', ')
    const ok = await confirm({
      title: 'Send the bills digest now?',
      message: `This emails the digest right now to: ${names}${cc.length ? ' (+ CC)' : ''}. Continue?`,
      confirmLabel: 'Send now', danger: false,
    })
    if (!ok) return
    setSendingHeads(true)
    try {
      const res = await fetch('/api/cron/bills-digest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ toHeads: true }) })
      const j = await res.json()
      if (!res.ok || j.ok === false) { toast.error(j.reason || j.error || 'Could not send'); return }
      const sentTo: string[] = j.sentTo ?? []
      const skipped: string[] = j.skipped ?? []
      const tgSent: string[] = j.tgSent ?? []
      const tgFailed: string[] = j.tgFailed ?? []
      if (sentTo.length) {
        const parts = [`Emailed ${sentTo.join(', ')}`]
        if (tgSent.length) parts.push(`Telegram → ${tgSent.join(', ')}`)
        if (tgFailed.length) parts.push(`Telegram failed: ${tgFailed.join(', ')}`)
        if (skipped.length) parts.push(`skipped ${skipped.join(', ')}`)
        toast.success(parts.join(' · '))
      } else toast.message('Nothing to send right now (no bills stuck for those projects).')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally { setSendingHeads(false) }
  }

  async function testTelegram() {
    if (assignedUsers.length === 0) { toast.error('Assign at least one head to a project first.'); return }
    setTgTesting(true)
    try {
      const res = await fetch('/api/cron/bills-digest', {
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
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2"><Mail className="h-4 w-4 text-rose-700" /> Daily bills digest</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-lg">
            Every day at 9 AM, each Atm Head gets one email with a status card per project they run — bills still with CT, sorted by days pending (oldest first), no amounts. Management CC people get every assigned project.
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

      {/* Head → projects */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Atm Head → projects
          <span className="font-normal text-gray-400">· {assignedUsers.length} head{assignedUsers.length === 1 ? '' : 's'} · {totalAssigned} project link{totalAssigned === 1 ? '' : 's'}</span>
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
                      ? <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 rounded-full px-2 py-0.5">{mine.length} project{mine.length === 1 ? '' : 's'}</span>
                      : <span className="text-[11px] text-gray-400">no projects</span>}
                    {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                  </span>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1 bg-gray-50/60 space-y-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Projects</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {projectOptions.map(({ code, label }) => (
                          <label key={code} className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer py-0.5">
                            <input type="checkbox" checked={mine.includes(code)} onChange={() => toggleProject(u.id, code)}
                              className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500" />
                            <span>{label !== code ? label : ''}<span className="font-mono text-gray-500">{label !== code ? ` (${code})` : code}</span></span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
                        Desk-stages to include {(stages[u.id]?.length ?? 0) === 0 && <span className="text-gray-400 normal-case font-normal">· default: Site Head only</span>}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {availableStages.map(st => (
                          <label key={st} className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer py-0.5">
                            <input type="checkbox" checked={(stages[u.id] ?? []).includes(st)} onChange={() => toggleStage(u.id, st)}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                            {stageLabel(st)}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">Expand a person to pick their <b>projects</b> and which <b>desk-stages</b> they get (leave stages blank = Site Head only). A CC person below gets every assigned project, filtered to their own stages.</p>
      </div>

      {/* Management CC */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">Also send to (management) — gets every assigned project</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-gray-200 p-3 max-h-40 overflow-auto">
          {users.map(u => (
            <label key={u.id} className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={cc.includes(u.id)} onChange={() => toggleCc(u.id)}
                className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500" />
              {nameOf(u)}
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <Button onClick={save} disabled={saving} className="bg-rose-700 hover:bg-rose-800">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : savedAt ? <Check className="h-4 w-4" /> : null}
          {savedAt ? 'Saved' : 'Save'}
        </Button>
        <Button variant="outline" onClick={sendTest} disabled={testing} title="Send yourself a preview right now">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send me a test
        </Button>
        <Button variant="outline" onClick={sendToHeads} disabled={sendingHeads || assignedUsers.length === 0}
          className="border-emerald-300 text-emerald-800 hover:bg-emerald-50" title="Email the digest to the assigned heads now">
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
        The digest reaches each head by <b className="font-medium text-gray-600">email</b> and, if they’ve linked it, <b className="font-medium text-gray-600">Telegram DM</b> (Settings → Notifications). <b className="font-medium text-gray-600">Test Telegram</b> pings the assigned heads’ DMs so you can see who’s connected anytime.
      </p>
    </Card>
  )
}
