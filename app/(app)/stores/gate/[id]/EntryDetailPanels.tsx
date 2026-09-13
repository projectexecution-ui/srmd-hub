'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { correctEntry, voidEntry } from '@/lib/stores/actions'
import { fmtQty } from '@/lib/stores/core'
import { formatDateTime, formatINR } from '@/lib/utils'
import type { EntryDetail } from '@/lib/stores/queries'
import { Field, inputClass, Btn, Notice, StageChip, RegisterChip, Scroller, th, td, tdNum } from '../../ui'

/** The fields a correction may touch. Anything that would change what the
 *  ledger says — quantity, rate, the item itself — is deliberately not here:
 *  that is a void and a fresh entry, so stock always has one explanation. */
const CORRECTABLE = [
  { field: 'vehicle_no', label: 'Vehicle number' },
  { field: 'driver_name', label: 'Driver name' },
  { field: 'driver_mobile', label: 'Driver mobile' },
  { field: 'driver_licence', label: 'Driver licence' },
  { field: 'party_name', label: 'Party' },
  { field: 'po_wo_no', label: 'PO / WO number' },
  { field: 'handed_over_to', label: 'Handed over to' },
  { field: 'remarks', label: 'Remarks' },
] as const

export function EntryDetailPanels({ entry }: { entry: EntryDetail }) {
  const router = useRouter()
  const total = entry.lines.reduce((s, l) => s + (l.amount ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-mono text-[15px] font-bold text-gray-900">{entry.no}</h2>
          <RegisterChip register={entry.register} />
          <StageChip stage={entry.stage} />
          {entry.edits.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10.5px] font-bold text-blue-900">
              corrected {entry.edits.length}×
            </span>
          )}
          <span className="ml-auto text-[12px] text-gray-500">{formatDateTime(entry.entryAt)}</span>
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 mt-4">
          <Cell label="Party" value={entry.partyName} />
          <Cell label="Vehicle" value={entry.vehicleNo} mono />
          <Cell label="Driver" value={entry.driverName} />
          <Cell label="Mobile" value={entry.driverMobile} mono />
          <Cell label="Licence" value={entry.driverLicence} mono />
          <Cell label="Project" value={entry.projectName} />
          <Cell label="PO / WO" value={entry.poWoNo} mono />
          <Cell label="Put away at" value={entry.locationName} />
          <Cell label="Security" value={entry.securityBy} />
          <Cell label="SRM Incharge" value={entry.inchargeName} />
          <Cell label="Handed over to" value={entry.handedOverTo} />
          <Cell label="Remarks" value={entry.remarks} />
        </dl>
      </div>

      {entry.lines.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
            <p className="text-[13px] font-bold text-gray-900">Items</p>
          </div>
          <Scroller min={640}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Item</th>
                  <th className={th}>Unit</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Returnable</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map(l => (
                  <tr key={l.id}>
                    <td className={td}>{l.itemName}</td>
                    <td className={td}>{l.unit}</td>
                    <td className={tdNum}>{fmtQty(l.qty)}</td>
                    <td className={tdNum}>{l.rate == null ? '—' : formatINR(l.rate)}</td>
                    <td className={tdNum}>{l.amount == null ? '—' : formatINR(l.amount)}</td>
                    <td className={td}>
                      {l.returnable
                        ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-900">Must come back</span>
                        : <span className="text-gray-400 text-[12px]">No</span>}
                    </td>
                  </tr>
                ))}
                {total > 0 && (
                  <tr className="bg-gray-50">
                    <td className={`${td} font-bold`} colSpan={4}>Total</td>
                    <td className={`${tdNum} font-bold`}>{formatINR(total)}</td>
                    <td className={td}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </Scroller>
        </div>
      )}

      {entry.stage !== 'void' && <Corrections entry={entry} onDone={() => router.refresh()} />}

      {entry.edits.length > 0 && (
        <details className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer list-none min-h-[44px] flex items-center gap-2">
            <span className="text-[13px] font-bold text-gray-900">What was corrected</span>
            <span className="text-[12px] text-gray-500">{entry.edits.length} change{entry.edits.length === 1 ? '' : 's'}</span>
            <span className="ml-auto text-[12px] font-semibold text-indigo-700">Show</span>
          </summary>
          <div className="border-t border-gray-100 divide-y divide-gray-100">
            {entry.edits.map(e => (
              <div key={e.id} className="px-4 py-2.5">
                <p className="text-[12.5px] text-gray-800">
                  <b>{e.field}</b>{' '}
                  <span className="text-gray-500 line-through">{e.oldValue || 'empty'}</span>{' → '}
                  <span className="font-semibold">{e.newValue || 'empty'}</span>
                </p>
                <p className="text-[11.5px] text-gray-400">
                  {e.changedBy ?? 'Someone'} · {formatDateTime(e.changedAt)}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function Cell({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className={`text-[13px] text-gray-900 mt-0.5 break-words ${mono ? 'font-mono text-[12.5px]' : ''}`}>
        {value || <span className="text-gray-300">—</span>}
      </dd>
    </div>
  )
}

function Corrections({ entry, onDone }: { entry: EntryDetail; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<string>(CORRECTABLE[0].field)
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <Btn kind="ghost" onClick={() => setOpen(true)}>Correct something</Btn>
          <p className="text-[12px] text-gray-500">
            The old value is kept and shown — a register that quietly rewrites itself is worse than none.
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-w-lg">
          <Field label="What is wrong">
            <select className={inputClass} value={field} onChange={e => { setField(e.target.value); setValue('') }}>
              {CORRECTABLE.map(c => <option key={c.field} value={c.field}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Correct value">
            <input className={inputClass} value={value} onChange={e => setValue(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Why" hint="Optional, but it is what makes the history readable in six months.">
            <input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} autoComplete="off" />
          </Field>
          {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Btn
              busy={pending}
              onClick={() => start(async () => {
                const r = await correctEntry(entry.id, field, value, reason)
                setResult(r)
                if (r.ok) { setValue(''); setReason(''); onDone() }
              })}
            >
              Save the correction
            </Btn>
            <Btn kind="ghost" onClick={() => { setOpen(false); setResult(null) }}>Cancel</Btn>
            <Btn
              kind="danger" busy={pending}
              onClick={() => {
                const why = window.prompt('Voiding keeps the entry but removes its stock. Why?')
                if (!why) return
                start(async () => {
                  const r = await voidEntry(entry.id, why)
                  setResult(r)
                  if (r.ok) onDone()
                })
              }}
            >
              Void this entry
            </Btn>
          </div>
          <p className="text-[11.5px] text-gray-500">
            Quantities, rates and the items themselves are not corrected here — changing those would change
            what the stock ledger says. Void the entry and record it again, so stock always has one explanation.
          </p>
        </div>
      )}
    </div>
  )
}
