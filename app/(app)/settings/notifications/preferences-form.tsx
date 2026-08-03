'use client'
// One form, four toggles. The Web Push toggle on its own is not enough
// to start sending — it just records "I want this". A separate Enable on
// this device button (Phase 2) registers the actual browser endpoint via
// PushManager.subscribe and saves it to public.push_subscriptions.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Bell, Mail, Send, Smartphone, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EnablePushButton } from '@/components/push/EnablePushButton'

interface Prefs {
  in_app: boolean
  email: boolean
  email_address: string
  telegram: boolean
  telegram_chat_id: string
  web_push: boolean
  digest_only: boolean
}

export function NotificationPreferencesForm({
  userId, initial,
}: {
  userId: string
  initial: Prefs
}) {
  const [p, setP] = useState<Prefs>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    setP(prev => ({ ...prev, [k]: v }))
    setSaved(false)
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    const supabase = createClient()
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({
        user_id: userId,
        in_app: p.in_app,
        email: p.email,
        email_address: p.email_address || null,
        telegram: p.telegram,
        telegram_chat_id: p.telegram_chat_id || null,
        web_push: p.web_push,
        digest_only: p.digest_only,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    setSaving(false)
    if (error) setError(error.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
  }

  return (
    <div className="space-y-3">
      <ChannelRow
        icon={Bell}
        title="In-app bell"
        description="Live updates in the top bar. The bell badge counts unread items."
        enabled={p.in_app}
        onToggle={v => set('in_app', v)}
        live
      />

      <ChannelRow
        icon={Mail}
        title="Email"
        description="A short summary email for each notification — opt for the digest if you prefer one a day."
        enabled={p.email}
        onToggle={v => set('email', v)}
      >
        {p.email && (
          <Input
            type="email"
            value={p.email_address}
            onChange={e => set('email_address', e.target.value)}
            placeholder="you@example.com"
            className="mt-2"
          />
        )}
      </ChannelRow>

      <ChannelRow
        icon={Send}
        title="Telegram"
        description="Get a ping on Telegram. We&apos;ll share a /start link to bind your chat once the bot is enabled."
        enabled={p.telegram}
        onToggle={v => set('telegram', v)}
      >
        {p.telegram && (
          <div className="mt-2 space-y-1">
            <Input
              value={p.telegram_chat_id}
              onChange={e => set('telegram_chat_id', e.target.value)}
              placeholder="Telegram chat id (set this by talking to the bot)"
            />
            <p className="text-[11px] text-gray-500">
              You&apos;ll get a /start link to bind this automatically when the Telegram bot goes live.
            </p>
          </div>
        )}
      </ChannelRow>

      <ChannelRow
        icon={Smartphone}
        title="Web push"
        description="Push notification on your phone or laptop even when CT HUB isn&apos;t open."
        enabled={p.web_push}
        onToggle={v => set('web_push', v)}
      >
        {p.web_push && <EnablePushButton />}
      </ChannelRow>

      <Card className="p-4 flex items-start gap-3">
        <input
          id="digest"
          type="checkbox"
          checked={p.digest_only}
          onChange={e => set('digest_only', e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="digest" className="text-sm leading-tight">
          <span className="font-medium text-gray-900">Digest only</span>
          <p className="text-xs text-gray-500 mt-0.5">
            Send one daily summary instead of one notification per event (applies to email + telegram).
          </p>
        </label>
      </Card>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save preferences
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  )
}

function ChannelRow({
  icon: Icon, title, description, enabled, onToggle, live, children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  live?: boolean
  children?: React.ReactNode
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={cn(
          'h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0',
          enabled ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-400',
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            {live ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                Live
              </span>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
                Setup pending
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
          {children}
        </div>
        <Toggle enabled={enabled} onChange={onToggle} />
      </div>
    </Card>
  )
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
        enabled ? 'bg-blue-600' : 'bg-gray-300',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
