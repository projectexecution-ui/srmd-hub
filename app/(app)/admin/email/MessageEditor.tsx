'use client'
import { useState, useTransition } from 'react'
import { Check, X, Loader2 } from 'lucide-react'
import { saveAddresses, saveEnabled, saveChannel } from './actions'

const CH_LABEL: Record<string, string> = { in_app: 'In-app', email: 'Email', web_push: 'Phone' }

function Note({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null
  return (
    <p
      role="status"
      className={`text-[11px] mt-1 flex items-center gap-1 ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}
    >
      {result.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {result.message}
    </p>
  )
}

/**
 * Everything about one message, changed where it is read.
 *
 * The first version of this page linked out to whichever module owned each
 * setting — six different screens, which is the problem it was meant to solve.
 * The controls are here now. Each one writes the same app_settings key the
 * module's own page writes, in that key's own format, so both stay in step.
 */
export function ChannelToggles({ eventType, channels, channelsOn }: {
  eventType: string; channels: string[]; channelsOn: string[]
}) {
  const [on, setOn] = useState(new Set(channelsOn))
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()

  const toggle = (channel: string) => {
    const next = !on.has(channel)
    start(async () => {
      const r = await saveChannel(eventType, channel, next)
      setResult(r)
      if (r.ok) {
        setOn(prev => {
          const s = new Set(prev)
          if (next) s.add(channel)
          else s.delete(channel)
          return s
        })
      }
    })
  }

  return (
    <div>
      <div className="flex gap-1 flex-wrap">
        {channels.map(c => (
          <button
            key={c}
            onClick={() => toggle(c)}
            disabled={pending}
            aria-pressed={on.has(c)}
            className={[
              'rounded px-2 py-1 text-[11px] font-semibold min-h-[32px] border transition-colors disabled:opacity-50',
              on.has(c)
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-gray-50 text-gray-400 border-gray-200 line-through',
            ].join(' ')}
          >
            {CH_LABEL[c] ?? c}
          </button>
        ))}
      </div>
      <Note result={result} />
    </div>
  )
}

export function EnabledToggle({ settingKey, enabled }: { settingKey: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="inline-flex flex-col">
      <button
        onClick={() => start(async () => {
          const r = await saveEnabled(settingKey, !on)
          setResult(r)
          if (r.ok) setOn(v => !v)
        })}
        disabled={pending}
        aria-pressed={on}
        className={[
          'rounded-full px-2.5 py-1 text-[10px] font-bold border min-h-[32px] disabled:opacity-50',
          on
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-gray-100 text-gray-500 border-gray-300',
        ].join(' ')}
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : on ? 'ON' : 'OFF'}
      </button>
      <Note result={result} />
    </div>
  )
}

export function AddressList({ settingKey, addresses }: { settingKey: string; addresses: string[] }) {
  const [value, setValue] = useState(addresses.join(', '))
  const [saved, setSaved] = useState(addresses.join(', '))
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()
  const dirty = value.trim() !== saved.trim()

  return (
    <div className="mt-1">
      <label className="block text-[11px] text-gray-400 mb-0.5" htmlFor={`addr-${settingKey}`}>
        Who receives it — email addresses, comma separated
      </label>
      <div className="flex flex-col sm:flex-row gap-1.5">
        <input
          id={`addr-${settingKey}`}
          value={value}
          onChange={e => { setValue(e.target.value); setResult(null) }}
          placeholder="nobody yet — add an address"
          className="flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs min-h-[44px] focus:border-indigo-400 focus:outline-none"
        />
        <button
          onClick={() => start(async () => {
            const r = await saveAddresses(settingKey, value)
            setResult(r)
            if (r.ok) setSaved(value)
          })}
          disabled={pending || !dirty}
          className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white min-h-[44px] hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {pending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      <Note result={result} />
    </div>
  )
}
