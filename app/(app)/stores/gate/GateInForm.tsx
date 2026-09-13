'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createGateEntry } from '@/lib/stores/actions'
import { missingForGate, type Register } from '@/lib/stores/core'
import { Field, inputClass, Btn, Notice } from '../ui'

/**
 * The guard's screen.
 *
 * The FIRST question is which register this is, because that one answer
 * decides everything downstream — vendor material goes to site and never
 * becomes stock; SRMD material goes to the store and does. Asking it plainly,
 * first, in words rather than jargon, is the whole reason the two registers
 * never get mixed up later.
 */
const REGISTERS: Array<{ key: Register; title: string; sub: string }> = [
  { key: 'vendor', title: 'Vendor material — goes to site', sub: 'Delivered against a PO or WO, straight to the project' },
  { key: 'srm',    title: 'SRMD stock — goes to the store',  sub: 'Into our own store, to be issued out later' },
]

export function GateInForm({ modes }: { modes: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [register, setRegister] = useState<Register>('srm')
  const [partyName, setPartyName] = useState('')
  const [vehicleNo, setVehicleNo] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverMobile, setDriverMobile] = useState('')
  const [driverLicence, setDriverLicence] = useState('')
  const [deliveryModeId, setDeliveryModeId] = useState('')
  const [remarks, setRemarks] = useState('')

  const handMode = modes.find(m => /hand/i.test(m.name))
  const isHand = !!handMode && deliveryModeId === handMode.id
  const missing = missingForGate({
    register, partyName, vehicleNo, driverName,
    deliveryModeId: isHand ? 'hand' : deliveryModeId,
  })

  const reset = () => {
    setPartyName(''); setVehicleNo(''); setDriverName(''); setDriverMobile('')
    setDriverLicence(''); setRemarks('')
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Btn onClick={() => { setOpen(true); setResult(null) }}>Record a vehicle</Btn>
        <p className="text-[12.5px] text-gray-500">Takes about two minutes on a phone.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 max-w-xl space-y-4">
      <div>
        <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
          What is coming in<span className="text-rose-600 ml-0.5">*</span>
        </span>
        <div className="grid gap-2">
          {REGISTERS.map(r => (
            <button
              key={r.key} type="button" onClick={() => setRegister(r.key)}
              className={`text-left rounded-lg border px-3 py-2.5 min-h-[44px] ${
                register === r.key ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200' : 'border-gray-300 bg-white hover:bg-gray-50'
              }`}
            >
              <span className="block text-[13px] font-semibold text-gray-900">{r.title}</span>
              <span className="block text-[11.5px] text-gray-500 mt-0.5">{r.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <Field label="Who is delivering" required>
        <input className={inputClass} value={partyName} onChange={e => setPartyName(e.target.value)}
          placeholder="Shree Balaji Steel Traders" autoComplete="off" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Delivery mode">
          <select className={inputClass} value={deliveryModeId} onChange={e => setDeliveryModeId(e.target.value)}>
            <option value="">Pick one</option>
            {modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Vehicle number" hint={isHand ? 'Not needed — hand delivered' : undefined}>
          <input className={inputClass} value={vehicleNo} onChange={e => setVehicleNo(e.target.value.toUpperCase())}
            placeholder="GJ 05 BX 4417" disabled={isHand} autoComplete="off" />
        </Field>
      </div>

      <Field label="Driver name">
        <input className={inputClass} value={driverName} onChange={e => setDriverName(e.target.value)}
          disabled={isHand} autoComplete="off" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Driver mobile">
          <input className={inputClass} value={driverMobile} onChange={e => setDriverMobile(e.target.value)}
            inputMode="tel" disabled={isHand} autoComplete="off" />
        </Field>
        <Field label="Driver licence">
          <input className={inputClass} value={driverLicence} onChange={e => setDriverLicence(e.target.value)}
            disabled={isHand} autoComplete="off" />
        </Field>
      </div>

      <Field label="Remarks">
        <input className={inputClass} value={remarks} onChange={e => setRemarks(e.target.value)} autoComplete="off" />
      </Field>

      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-center">
        <p className="text-[12.5px] text-gray-600">📷 Delivery challan · Bill / invoice · E-way bill</p>
        <p className="text-[11.5px] text-gray-400 mt-0.5">
          Not wired yet — waiting on your answer about how long photos are kept.
        </p>
      </div>

      {/* Say what is missing; never disable the button without saying why. */}
      {missing.length > 0 && (
        <Notice kind="info">Still needed: {missing.join(' · ')}</Notice>
      )}
      {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

      <div className="flex flex-wrap gap-2">
        <Btn
          busy={pending}
          onClick={() => start(async () => {
            const r = await createGateEntry({
              register, partyName, vehicleNo, driverName, driverMobile, driverLicence,
              deliveryModeId: deliveryModeId || null, remarks,
            })
            setResult(r)
            if (r.ok) { reset(); router.refresh() }
          })}
        >
          Save &amp; send to storekeeper
        </Btn>
        <Btn kind="ghost" onClick={() => { setOpen(false); setResult(null) }}>Close</Btn>
      </div>

      <p className="text-[11.5px] text-gray-500">
        Your name and the time are stamped on it as the security signature.
      </p>
    </div>
  )
}
