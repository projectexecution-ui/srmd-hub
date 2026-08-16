'use client'
// "Connect Telegram" card (management only). One tap mints a link, opens the
// bot, and — once the user taps Start in Telegram — the webhook binds their
// chat and flips their Telegram channel on. Admins also get a one-click
// "Set up bot" button that registers the webhook.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Send, Check, Loader2, RefreshCcw, Unplug, Settings2, Copy } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { startTelegramLink, unlinkTelegram } from './telegram-actions'

export function TelegramConnect({
  connected, linkedAt, isAdmin,
}: {
  connected: boolean
  linkedAt: string | null
  isAdmin: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [setupMsg, setSetupMsg] = useState<string | null>(null)

  async function connect() {
    setBusy(true); setErr(null); setSetupMsg(null); setCopied(false)
    const r = await startTelegramLink()
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    setLink(r.link)
    setOpened(true)
    window.open(r.link, '_blank', 'noopener,noreferrer')
  }

  async function copyLink() {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }

  async function disconnect() {
    setBusy(true); setErr(null)
    const r = await unlinkTelegram()
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not disconnect'); return }
    router.refresh()
  }

  async function runSetup() {
    setBusy(true); setErr(null); setSetupMsg(null)
    try {
      const res = await fetch('/api/telegram/setup', { method: 'POST' })
      const j = await res.json()
      if (j.ok) setSetupMsg(`Bot @${j.botUsername} is ready — the webhook is registered. People can now connect.`)
      else setErr(j.reason ?? 'Setup failed')
    } catch { setErr('Setup failed') }
    setBusy(false)
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${connected ? 'bg-sky-50 text-sky-600' : 'bg-gray-100 text-gray-400'}`}>
          <Send className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Telegram</h3>
            {connected && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                <Check className="h-3 w-3" /> Connected
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Get your CT Hub reports and alerts as Telegram messages — approvals, procurement follow-ups,
            bills, the daily site report, and more. Turn on <b>Digest only</b> above for one daily summary instead.
          </p>
          {!connected && (
            <p className="text-xs text-gray-500 mt-1">
              <b>No code to type.</b> Tap <b>Connect Telegram</b> → Telegram opens → tap <b>Start</b> there → come back and refresh.
            </p>
          )}

          {connected ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-600">
                Linked{linkedAt ? ` on ${formatDateTime(linkedAt)}` : ''}. Send <b>/stop</b> in the chat, or:
              </span>
              <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}
                className="text-rose-700 border-rose-300 hover:bg-rose-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <Button size="sm" onClick={connect} disabled={busy} className="font-semibold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Connect Telegram
              </Button>
              {opened && (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-900 space-y-1.5">
                  <div>
                    Telegram opened in a new tab — tap <b>Start</b> in the chat, then come back and refresh.
                    <button onClick={() => router.refresh()} className="ml-2 inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline">
                      <RefreshCcw className="h-3 w-3" /> Refresh
                    </button>
                  </div>
                  {link && (
                    <div className="text-[11px] text-sky-800">
                      Didn’t open? Copy this link and paste it into Telegram (or open it on your phone), then tap <b>Start</b>:
                      <div className="mt-1 flex items-center gap-1.5">
                        <code className="flex-1 min-w-0 truncate rounded bg-white/70 border border-sky-200 px-1.5 py-1 text-sky-900">{link}</code>
                        <button onClick={copyLink} className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline flex-shrink-0">
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1.5">Admin — bot setup</p>
              <Button variant="outline" size="sm" onClick={runSetup} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
                Set up bot webhook
              </Button>
              <p className="text-[11px] text-gray-500 mt-1.5">
                Run this once after adding <code className="text-gray-700">TELEGRAM_BOT_TOKEN</code> on Vercel — it points the bot at CT Hub.
              </p>
              {setupMsg && <p className="text-xs text-green-700 mt-1.5">{setupMsg}</p>}
            </div>
          )}

          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        </div>
      </div>
    </Card>
  )
}
