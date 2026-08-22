'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { startCount } from '../actions'
import { SCOPE_LABEL } from '@/lib/warehouse/count'
import type { CountScope } from '@/lib/warehouse/count'
import type { WhSite } from '@/lib/warehouse/types'
import { Loader2, EyeOff, Eye } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[44px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

const SCOPES: CountScope[] = ['spot_top', 'location', 'full']

export function CountStart({
  sites, postableSpotIds, scopingOff, itemsPerStore, witnesses, canEdit, nextCountNo,
  blindDefault, witnessRequired,
}: {
  sites: WhSite[]
  postableSpotIds: string[]
  scopingOff: boolean
  itemsPerStore: Record<string, number>
  witnesses: Array<{ id: string; name: string }>
  canEdit: boolean
  nextCountNo: string
  /** The Settings default. Still changeable per count. */
  blindDefault: boolean
  witnessRequired: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [locationId, setLocationId] = useState('')
  const [scope, setScope] = useState<CountScope>('location')
  const [witnessId, setWitnessId] = useState('')
  const [blind, setBlind] = useState(blindDefault)

  const postable = new Set(postableSpotIds)
  const held = itemsPerStore[locationId] ?? 0

  function go() {
    start(async () => {
      const res = await startCount({
        locationId,
        scope,
        witnessId: witnessId || null,
        blind,
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success(`Started ${res.countNo}`)
      router.push(`/warehouse/count/${res.id}`)
    })
  }

  return (
    <Card className="p-0 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-violet-700 text-white flex items-center gap-2">
        <h3 className="font-bold text-sm">Start a count</h3>
        <span className="ml-auto font-mono text-[11px] opacity-90">{nextCountNo}</span>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className={labelCls} htmlFor="count-store">Which store are you standing in</label>
          <select id="count-store" className={inputCls} value={locationId}
            onChange={e => setLocationId(e.target.value)}>
            <option value="">Pick a store…</option>
            {sites.map(site => (
              <optgroup key={site.id} label={site.name}>
                {site.spots.map(sp => (
                  <option key={sp.id} value={sp.id} disabled={!postable.has(sp.id)}>
                    {sp.name}
                    {itemsPerStore[sp.id] ? ` · ${itemsPerStore[sp.id]} items` : ' · nothing in book stock'}
                    {!postable.has(sp.id) ? ' · not your store' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {!scopingOff && (
            <p className="text-[11px] text-slate-500 mt-1">You can only count the stores you keep.</p>
          )}
        </div>

        <div>
          <label className={labelCls}>How much of it</label>
          <div className="space-y-1.5">
            {SCOPES.map(s => {
              const on = scope === s
              const meta = SCOPE_LABEL[s]
              return (
                <button key={s} type="button" onClick={() => setScope(s)}
                  aria-pressed={on}
                  className={`w-full text-left rounded-xl border-2 px-3 py-2 transition ${
                    on ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <span className={`block text-[13px] font-bold ${on ? 'text-violet-900' : 'text-slate-700'}`}>
                    {meta.title}
                  </span>
                  <span className={`block text-[11px] mt-0.5 leading-snug ${on ? 'text-violet-700' : 'text-slate-500'}`}>
                    {meta.blurb}
                  </span>
                </button>
              )
            })}
          </div>
          {locationId && (
            <p className="text-[11px] text-slate-500 mt-1.5">
              {held === 0
                ? 'The book says nothing is in this store. A count here can only record what you find — useful if material arrived without a gate entry.'
                : scope === 'spot_top'
                  ? `About ${Math.min(held, 20)} of the ${held} items in this store.`
                  : `${held} ${held === 1 ? 'item' : 'items'} to walk.`}
            </p>
          )}
        </div>

        <div>
          <label className={labelCls} htmlFor="count-witness">Who is with you</label>
          <select id="count-witness" className={inputCls} value={witnessId}
            onChange={e => setWitnessId(e.target.value)}>
            <option value="">Pick the witness…</option>
            {witnesses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            {witnessRequired
              ? 'Needed before you can submit — a keeper counting his own store alone is checking himself.'
              : 'Not compulsory at the moment, but a count with a witness is the one nobody argues with. '
                + 'An admin can make it compulsory again in Settings.'}
          </p>
        </div>

        {/* Blind by default. Shown the book figure first, the eye writes the
            number down for you and the count stops being evidence of anything. */}
        <div>
          <label className={labelCls}>Book quantity while counting</label>
          <div className="grid grid-cols-2 gap-0 rounded-lg border-2 border-slate-200 overflow-hidden">
            <button type="button" onClick={() => setBlind(true)} role="switch" aria-checked={blind}
              className={`py-2.5 min-h-[44px] text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 ${
                blind ? 'bg-slate-700 text-white' : 'bg-white text-slate-600'}`}>
              <EyeOff className="h-3.5 w-3.5" /> Hidden
            </button>
            <button type="button" onClick={() => setBlind(false)} role="switch" aria-checked={!blind}
              className={`py-2.5 min-h-[44px] text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 border-l-2 border-slate-200 ${
                !blind ? 'bg-slate-700 text-white' : 'bg-white text-slate-600'}`}>
              <Eye className="h-3.5 w-3.5" /> Shown
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {blind
              ? 'You will not see what the book says until you have entered your number. This is what makes the count worth doing.'
              : 'You will see the book quantity as you count — faster, but it is easy to just agree with it.'}
          </p>
        </div>

        <button type="button" disabled={!canEdit || pending || !locationId} onClick={go}
          className="w-full rounded-lg bg-violet-700 hover:bg-violet-800 py-2.5 min-h-[44px] text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2 transition">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? 'Starting…' : 'Start counting'}
        </button>
        {!locationId && (
          <p className="text-[11px] text-slate-500 text-center">Pick the store you are standing in to start.</p>
        )}
        <p className="text-[11px] text-slate-500 text-center">
          The book quantities are frozen the moment you start, so a truck arriving mid-count cannot invent a difference.
        </p>
      </div>
    </Card>
  )
}
