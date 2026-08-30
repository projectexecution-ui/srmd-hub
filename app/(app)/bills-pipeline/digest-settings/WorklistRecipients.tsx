'use client'
// Recipients of the daily stuck-bills worklist email.
// The cron (app/api/cron/bills-stuck-worklist) has always read
// app_settings.bills_worklist_to, but nothing wrote it — so the address could
// only be changed in code. This is that missing field.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Check, Send, Inbox } from 'lucide-react'
import { toast } from 'sonner'

/** Same fallback the cron uses when the key is unset — shown, never hidden. */
const CRON_FALLBACK = 'mayank.srmd@gmail.com'

function splitEmails(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export function WorklistRecipients({ initial }: { initial: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)

  const entered = splitEmails(value)
  const invalid = entered.filter(e => !e.includes('@'))
  const valid = entered.filter(e => e.includes('@'))
  // Empty is legitimate — it means "fall back to the built-in address".
  const effective = valid.length > 0 ? valid : [CRON_FALLBACK]

  async function save() {
    if (invalid.length > 0) {
      toast.error(`Not an email address: ${invalid.join(', ')}`)
      return
    }
    setSaving(true)
    const { error } = await createClient()
      .from('app_settings')
      .upsert({ key: 'bills_worklist_to', value: valid.join(', ') }, { onConflict: 'key' })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
    toast.success('Saved')
    router.refresh()
  }

  async function sendTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/cron/bills-stuck-worklist', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) { toast.error(j.reason || j.error || 'Could not send the test'); return }
      toast.success('Test sent to your own email — the saved recipients were not emailed.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Network error')
    } finally { setTesting(false) }
  }

  return (
    <Card className="p-4 md:p-5 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-orange-700" /> Stuck-bills worklist — who gets it
        </h3>
        <p className="text-xs text-gray-500 mt-1 max-w-2xl">
          The daily list of bills sitting with CT. Separate several addresses with commas.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-gray-600" htmlFor="worklist-to">
          Email address(es)
        </label>
        <input
          id="worklist-to"
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={CRON_FALLBACK}
          className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
        />
        {invalid.length > 0 && (
          <p className="text-[11px] text-red-600">
            Not an email address: {invalid.join(', ')} — fix it before saving.
          </p>
        )}
        <p className="text-[11px] text-gray-400">
          {valid.length === 0
            ? <>Left empty, so it goes to the built-in address: <b className="font-medium text-gray-600">{CRON_FALLBACK}</b>.</>
            : <>Goes to {effective.length} address{effective.length === 1 ? '' : 'es'}: <b className="font-medium text-gray-600">{effective.join(', ')}</b>.</>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={save} disabled={saving} className="bg-orange-700 hover:bg-orange-800">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? 'Saved' : 'Save'}
        </Button>
        <Button variant="outline" onClick={sendTest} disabled={testing} title="Sends only to you">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send me a test
        </Button>
      </div>
    </Card>
  )
}
