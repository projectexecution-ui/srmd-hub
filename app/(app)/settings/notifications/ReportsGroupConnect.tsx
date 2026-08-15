'use client'
// "Reports group" card (admin only). Registers a shared management Telegram
// GROUP that receives the curated broadcast cards (the weekly Budget vs Actual
// portfolio) — on top of everyone's personal DMs. Approvals / @mentions never
// go here. The group is captured by typing /reportshere inside it (the bot must
// be a group admin); this card shows the status + a one-tap Disconnect.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Users, Check, Loader2, Unplug, Send } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { disconnectReportsGroup } from './telegram-actions'

export function ReportsGroupConnect({
  group, botUsername,
}: {
  group: { title: string; at: string | null } | null
  botUsername: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function disconnect() {
    setBusy(true); setErr(null); setMsg(null)
    const r = await disconnectReportsGroup()
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not disconnect'); return }
    router.refresh()
  }

  async function sendTest() {
    setTestBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/cron/cc-budget-vs-actual', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ group: true }),
      })
      const j = await res.json()
      if (res.ok && j.ok) setMsg('Sent — check the group in Telegram.')
      else setErr(j.reason ?? 'Could not send the test card.')
    } catch { setErr('Could not send the test card.') }
    setTestBusy(false)
  }

  const botTag = botUsername ? `@${botUsername}` : 'the CT Hub bot'

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${group ? 'bg-sky-50 text-sky-600' : 'bg-gray-100 text-gray-400'}`}>
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Reports group</h3>
            {group && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                <Check className="h-3 w-3" /> Connected
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Send the curated broadcast cards (like the <b>weekly Budget vs Actual</b>) to a shared
            management group — a notice board everyone can see. Approvals and @mentions still go only
            to each person&apos;s own DM.
          </p>

          {group ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-600">
                Connected to <b>{group.title}</b>{group.at ? ` on ${formatDateTime(group.at)}` : ''}. Everyone in that group sees these reports — keep it management-only.
              </span>
              <Button variant="outline" size="sm" onClick={sendTest} disabled={testBusy || busy}>
                {testBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send a test card
              </Button>
              <Button variant="outline" size="sm" onClick={disconnect} disabled={busy || testBusy}
                className="text-rose-700 border-rose-300 hover:bg-rose-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2.5">
              <p className="text-xs font-semibold text-sky-900 mb-1.5">Set it up in Telegram (2 minutes):</p>
              <ol className="text-xs text-sky-900 space-y-1 list-decimal pl-4">
                <li>Create a Telegram group with your management team.</li>
                <li>Add the bot <b>{botTag}</b> to the group.</li>
                <li>Make the bot an <b>admin</b> of the group (so it can post + read the command).</li>
                <li>In the group, type <code className="bg-white border border-sky-200 rounded px-1">/reportshere</code> — it&apos;ll confirm.</li>
              </ol>
              <p className="text-[11px] text-sky-800 mt-1.5">
                Only a management member who has connected their own Telegram can register the group. To turn it off later, type <b>/stop</b> in the group or use Disconnect here.
              </p>
            </div>
          )}

          {msg && <p className="text-xs text-green-700 mt-2">{msg}</p>}
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        </div>
      </div>
    </Card>
  )
}
