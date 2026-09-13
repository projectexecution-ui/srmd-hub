'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, ClipboardList, Warehouse, Camera } from 'lucide-react'
import { createGateEntry } from '@/lib/stores/actions'
import { T, stepsFor, canLeave, summaryOf, modeIcon, type GateAnswers } from '@/lib/stores/lang'
import {
  Progress, Question, BigChoice, BigInput, QuickPicks, BottomBar, FieldCard, BigNotice,
} from '../field'

/**
 * The guard's screen — one question at a time.
 *
 * It replaced a single form of nine fields. A form is fine for someone who
 * reads it once and learns the shape; it is the wrong object entirely for
 * somebody who reads English slowly, standing at a gate with a lorry waiting.
 * One question fills the screen, in plain words, and the answer is usually a
 * tap rather than typing.
 *
 * Only three answers are compulsory — what, who, how. A guard who cannot read
 * the licence plate through the dust must still be able to finish, or the
 * lorry waits at the gate for a number nobody has.
 */
export function GateInForm({
  modes, recentParties = [],
}: {
  modes: Array<{ id: string; name: string }>
  recentParties?: string[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [a, setA] = useState<GateAnswers>({})
  const [saved, setSaved] = useState<{ no: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const steps = stepsFor(a)
  const step = steps[Math.min(i, steps.length - 1)]
  const set = (patch: Partial<GateAnswers>) => setA(prev => ({ ...prev, ...patch }))

  const reset = () => { setA({}); setI(0); setSaved(null); setError(null) }

  const submit = () => start(async () => {
    setError(null)
    const mode = modes.find(m => m.name === a.modeName)
    const r = await createGateEntry({
      register: a.register ?? 'srm',
      partyName: a.partyName ?? '',
      vehicleNo: a.vehicleNo, driverName: a.driverName,
      driverMobile: a.driverMobile, driverLicence: a.driverLicence,
      deliveryModeId: mode?.id ?? null,
    })
    if (r.ok && r.data) { setSaved({ no: r.data.no }); router.refresh() }
    else setError(r.message)
  })

  /* ── Closed ───────────────────────────────────────────────────────────── */
  if (!open) {
    return (
      <button
        type="button" onClick={() => { setOpen(true); reset() }}
        className="w-full sm:w-auto inline-flex items-center gap-3 rounded-2xl bg-indigo-700 px-5 py-4 min-h-[64px]
          text-white shadow-sm active:bg-indigo-800"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
          <ClipboardList className="h-5 w-5" strokeWidth={2.5} />
        </span>
        <span className="text-[17px] font-bold">{T.gateTitle}</span>
      </button>
    )
  }

  /* ── Saved ────────────────────────────────────────────────────────────── */
  if (saved) {
    return (
      <FieldCard>
        <div className="pb-5 text-center space-y-4">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-9 w-9 text-emerald-700" strokeWidth={2.5} />
          </span>
          <p className="text-[22px] font-bold text-emerald-900">{T.saved}</p>
          <p className="font-mono text-[26px] font-bold text-gray-900 tracking-tight">{saved.no}</p>
          <p className="text-[14px] text-gray-500">{T.savedSub}</p>
        </div>
        <BottomBar nextLabel={T.newEntry} onNext={reset}>
          <button type="button" onClick={() => { setOpen(false); reset() }}
            className="w-full mb-2.5 rounded-2xl border-2 border-gray-300 bg-white min-h-[52px] text-[15px] font-semibold text-gray-700 active:bg-gray-100">
            {T.cancel}
          </button>
        </BottomBar>
      </FieldCard>
    )
  }

  /* ── The wizard ───────────────────────────────────────────────────────── */
  const last = i >= steps.length - 1
  const ready = canLeave(step, a)

  return (
    <FieldCard>
      <div className="space-y-5 pb-2">
        <Progress current={i} total={steps.length} />

        {step === 'what' && (
          <>
            <Question t={T.qWhat} />
            <div className="space-y-2.5">
              <BigChoice
                icon="truck" selected={a.register === 'vendor'}
                onClick={() => { set({ register: 'vendor' }); setI(i + 1) }}
                t={T.vendorTitle} sub={T.vendorSub}
              />
              <BigChoice
                icon="other" selected={a.register === 'srm'}
                onClick={() => { set({ register: 'srm' }); setI(i + 1) }}
                t={T.srmTitle} sub={T.srmSub}
              />
            </div>
          </>
        )}

        {step === 'who' && (
          <>
            <Question t={T.qWho} hint={T.whoHint} />
            <QuickPicks options={recentParties} onPick={v => set({ partyName: v })} />
            <BigInput value={a.partyName ?? ''} onChange={v => set({ partyName: v })} autoFocus />
          </>
        )}

        {step === 'how' && (
          <>
            <Question t={T.qHow} />
            <div className="space-y-2.5">
              {modes.map(m => (
                <BigChoice
                  key={m.id} t={m.name} icon={modeIcon(m.name)}
                  selected={a.modeName === m.name}
                  onClick={() => { set({ modeName: m.name }); setI(i + 1) }}
                />
              ))}
            </div>
          </>
        )}

        {step === 'vehicle' && (
          <>
            <Question t={T.qVehicle} hint={T.vehicleHint} />
            <BigInput upper value={a.vehicleNo ?? ''} onChange={v => set({ vehicleNo: v })}
              placeholder="GJ 05 BX 4417" autoFocus />
          </>
        )}

        {step === 'driver' && (
          <>
            <Question t={T.qDriver} />
            <div className="space-y-3.5">
              <BigInput t={T.driverName} value={a.driverName ?? ''} onChange={v => set({ driverName: v })} autoFocus />
              <BigInput t={T.driverMobile} mode="tel" value={a.driverMobile ?? ''} onChange={v => set({ driverMobile: v })} />
              <BigInput t={T.driverLicence} value={a.driverLicence ?? ''} onChange={v => set({ driverLicence: v })} upper />
            </div>
          </>
        )}

        {step === 'papers' && (
          <>
            <Question t={T.qPapers} hint={T.papersHint} />
            <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
              <Camera className="mx-auto h-10 w-10 text-gray-300" strokeWidth={1.75} />
              <p className="mt-2.5 text-[16px] font-semibold text-gray-500">{T.photoSoon}</p>
              <p className="mt-2 text-[12.5px] text-gray-400 max-w-[28ch] mx-auto">
                Waiting on the decision about how long pictures are kept.
              </p>
            </div>
          </>
        )}

        {step === 'check' && (
          <>
            <Question t={T.qCheck} />
            <dl className="rounded-2xl border-2 border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {summaryOf(a).map((row, n) => (
                <div key={n} className="flex items-start gap-3 px-4 py-3">
                  <dt className="w-[42%] shrink-0 text-[13px] font-semibold text-gray-500">{row.label}</dt>
                  <dd className="flex-1 text-[17px] font-semibold text-gray-900 break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
            {error && <BigNotice kind="bad" title={error} />}
          </>
        )}
      </div>

      <BottomBar
        onBack={i > 0 ? () => { setI(i - 1); setError(null) } : undefined}
        onNext={last ? submit : () => setI(i + 1)}
        nextLabel={last ? T.save : T.next}
        nextDisabled={!ready}
        busy={pending}
      >
        {/* Never a dead button with no explanation: say what is missing, in
            both languages, right where the thumb is about to press. */}
        {!ready && (
          <p className="mb-2.5 text-center text-[14px] font-semibold text-amber-800">{T.needed}</p>
        )}
        {ready && !last && (step === 'vehicle' || step === 'driver' || step === 'papers') && (
          <button type="button" onClick={() => setI(i + 1)}
            className="w-full mb-2.5 text-center text-[14px] font-semibold text-gray-400 min-h-[44px]">
            {T.skip}
          </button>
        )}
      </BottomBar>
    </FieldCard>
  )
}

/** The storekeeper's own front door, same visual language as the guard's. */
export function StorekeeperCta({ waiting }: { waiting: number }) {
  return (
    <div className={`rounded-2xl border-2 px-4 py-4 flex items-center gap-3.5 ${
      waiting > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
        waiting > 0 ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
        <Warehouse className="h-6 w-6" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-[16px] font-bold text-gray-900">
          {waiting > 0 ? `${waiting} ${waiting === 1 ? 'vehicle' : 'vehicles'} to count in` : 'Nothing waiting'}
        </p>
        <p className="text-[13px] text-gray-500">
          {waiting > 0 ? 'Open one to count the material in' : 'Every vehicle has been counted in'}
        </p>
      </div>
    </div>
  )
}
