'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { correctEntry, voidEntry, confirmReceipt } from '@/lib/stores/actions'
import { fmtQty, RETURNABLES_ON } from '@/lib/stores/core'
import { signaturesFor, type SignedSlot } from '@/lib/stores/desk'
import { formatDateTime, formatINR } from '@/lib/utils'
import { PenLine } from 'lucide-react'
import type { EntryDetail } from '@/lib/stores/queries'
import { Field, inputClass, Btn, Notice, StageChip, RegisterChip, Scroller, th, thNum, td, tdNum } from '../../ui'

/** The fields a correction may touch. Anything that would change what the
 *  ledger says — quantity, rate, the item itself — is deliberately not here:
 *  that is a void and a fresh entry, so stock always has one explanation. */
const CORRECTABLE = [
  { field: 'vehicle_no', label: 'Vehicle number' },
  { field: 'driver_name', label: 'Driver name' },
  { field: 'driver_mobile', label: 'Driver mobile' },
  { field: 'driver_licence', label: 'Driver licence' },
  { field: 'party_name', label: 'Party' },
  { field: 'po_wo_no', label: 'Purchase order number' },
  { field: 'handed_over_to', label: 'Handed over to' },
  { field: 'remarks', label: 'Remarks' },
] as const

export function EntryDetailPanels({
  entry, places = [],
}: {
  entry: EntryDetail
  /** Where it could have been put down at the far end — the map's "capture
   *  where the materials are being stored". */
  places?: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const total = entry.lines.reduce((s, l) => s + (l.amount ?? 0), 0)
  const slots = signaturesFor(entry.direction, { ...entry.signatures, completedBy: entry.completedBy, completedAt: entry.completedAt })

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
          <SlipButtons entry={entry} />
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 mt-4">
          <Cell label="Party" value={entry.partyName} />
          <Cell label="Vehicle" value={entry.vehicleNo} mono />
          <Cell label="Driver" value={entry.driverName} />
          <Cell label="Mobile" value={entry.driverMobile} mono />
          <Cell label="Licence" value={entry.driverLicence} mono />
          <Cell label="Project" value={entry.projectName} />
          <Cell label="Purchase order" value={entry.poWoNo} mono />
          <Cell label="Put away at" value={entry.locationName} />
          {/* On an OUT, `security_by` holds the STOREKEEPER who issued it —
              issueRequest writes their name there. Labelling that "Security"
              is the same confusion as the receiver box: a word that does not
              mean what it says. */}
          <Cell label={entry.direction === 'in' ? 'Security' : 'Issued by'} value={entry.securityBy} />
          {entry.direction === 'in' && <Cell label="SRM Incharge" value={entry.inchargeName} />}
          <Cell label="Handed over to" value={entry.handedOverTo} />
          <Cell label="Remarks" value={entry.remarks} />
        </dl>

        {/* The photographs. Taken since the camera was wired, recorded
            against every entry — and shown on NO screen, because the bucket is
            private and a stored path is not a web address. A photograph nobody
            can look at is the same as one nobody took. */}
        {entry.photos.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">
              Photographs ({entry.photos.length})
            </p>
            <ul className="flex flex-wrap gap-2.5">
              {entry.photos.map(p => (
                <li key={p.id}>
                  <Shot photo={p} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* WHICH signatures apply is decided in lib/stores/desk.ts, by
            direction. All three used to be drawn on every entry, so a finished
            IN carried a hollow "Receiver · Not signed" for a step that only
            ever runs on an OUT — Aksha, 16 Sep 2026: "i dont know this cycle
            is closed - why its showing am i missing something". */}
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">Signed by</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {slots.map(s => <Signed key={s.key} slot={s} />)}
          </div>
        </div>
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
                  <th className={thNum}>Qty</th>
                  <th className={thNum}>Rate</th>
                  <th className={thNum}>Amount</th>
                  {RETURNABLES_ON && <th className={th}>Returnable</th>}
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
                    {RETURNABLES_ON && (
                      <td className={td}>
                        {l.returnable
                          ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-900">Must come back</span>
                          : <span className="text-gray-400 text-[12px]">No</span>}
                      </td>
                    )}
                  </tr>
                ))}
                {total > 0 && (
                  <tr className="bg-gray-50">
                    <td className={`${td} font-bold`} colSpan={4}>Total</td>
                    <td className={`${tdNum} font-bold`}>{formatINR(total)}</td>
                    {RETURNABLES_ON && <td className={td}></td>}
                  </tr>
                )}
              </tbody>
            </table>
          </Scroller>
        </div>
      )}

      {/* The map's "SRM Engg receives the materails & checks & Signs". Only on
          an OUT, and only while nobody has signed — once signed it is history. */}
      {entry.direction === 'out' && entry.stage !== 'void' && !entry.signatures.receiver.at && (
        <Receipt entryId={entry.id} entryNo={entry.no} places={places} onDone={() => router.refresh()} />
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

/**
 * Signing for material received.
 *
 * The one step that was missing from the whole chain: the map ends SRM Out with
 * the engineer checking and signing, and until now nothing wrote that — so the
 * Receiver box on every entry was empty for ever.
 *
 * Whoever is signed in signs. Their name and the moment are stamped, and the
 * entry closes.
 */
function Receipt({
  entryId, entryNo, places, onDone,
}: {
  entryId: string; entryNo: string
  places: Array<{ id: string; label: string }>
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [toLocation, setToLocation] = useState('')
  const [note, setNote] = useState('')

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-4 space-y-3">
      <div>
        <p className="text-[14px] font-bold text-gray-900">Waiting to be signed for</p>
        <p className="text-[12.5px] text-gray-600 mt-0.5">
          Whoever received this material signs here. Your name and the time are stamped on {entryNo}.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 max-w-2xl">
        <Field label="Where it was put down" hint="Optional — the map's “capture where the materials are being stored”.">
          <select className={inputClass} value={toLocation} onChange={e => setToLocation(e.target.value)}>
            <option value="">Not recorded</option>
            {places.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Anything to note">
          <input className={inputClass} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </div>

      {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

      <Btn
        busy={pending}
        onClick={() => start(async () => {
          const r = await confirmReceipt({ entryId, toLocationId: toLocation || null, note })
          setResult(r)
          if (r.ok) onDone()
        })}
      >
        I received this
      </Btn>
    </div>
  )
}

/**
 * One signature point.
 *
 * A name and a time, because that is what the app can actually prove — the
 * person was signed in and pressed the button. It also says WHAT signing it
 * meant, which is the thing the box was missing: "Receiver" on its own is a
 * word, and nobody reading a finished entry could tell whether it mattered.
 */
function Signed({ slot }: { slot: SignedSlot }) {
  const signed = !!slot.at
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${
      signed ? 'border-emerald-200 bg-emerald-50/60' : 'border-dashed border-gray-300 bg-gray-50'}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{slot.label}</p>
      {signed ? (
        <>
          <p className="text-[13.5px] font-semibold text-gray-900 mt-0.5 flex items-center gap-1.5">
            <PenLine className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
            {slot.who || 'Signed'}
          </p>
          <p className="text-[11.5px] text-gray-500">{formatDateTime(slot.at)}</p>
        </>
      ) : (
        <p className="text-[13px] text-gray-500 mt-0.5">{slot.waitingFor}</p>
      )}
      <p className="text-[11px] text-gray-400 leading-snug mt-1">{slot.what}</p>
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

/**
 * One photograph or video from the entry.
 *
 * A video is not shown as a thumbnail — a poster frame would need decoding it
 * — so it is named and opens in its own tab. What matters on this screen is
 * that it EXISTS and can be reached; watching it is a deliberate act.
 */
function Shot({ photo }: { photo: EntryDetail['photos'][number] }) {
  const label = PHOTO_WORDS[photo.kind] ?? photo.kind
  const isVideo = /\.(mp4|mov|webm)$/i.test(photo.path)

  if (!photo.url) {
    return (
      <div className="w-[104px] rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2 text-center">
        <p className="text-[11px] font-semibold text-gray-600">{label}</p>
        <p className="text-[10.5px] text-gray-400 mt-0.5">could not be fetched</p>
      </div>
    )
  }

  return (
    <a
      href={photo.url} target="_blank" rel="noopener noreferrer"
      className="block w-[104px] rounded-lg border border-gray-200 overflow-hidden hover:border-indigo-300 hover:shadow-sm"
    >
      {isVideo ? (
        <span className="flex h-[78px] items-center justify-center bg-gray-900 text-white text-[11px] font-semibold">
          ▶ video
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt={label} className="h-[78px] w-full object-cover" loading="lazy" />
      )}
      <span className="block px-1.5 py-1 text-[10.5px] font-semibold text-gray-600 truncate">{label}</span>
    </a>
  )
}

/** What each kind of photograph is called, in the words the field screens use
 *  rather than the database's own. */
const PHOTO_WORDS: Record<string, string> = {
  challan: 'The papers',
  item: 'The material',
  location: 'Where it was put',
  video: 'The load',
}

/**
 * The slip that travels with the lorry.
 *
 * Share hands the PDF to whatever the phone shares with — WhatsApp, in
 * practice. On a laptop there is nothing to share to, so both buttons
 * download, and the second is hidden rather than offered and doing the same
 * thing as the first.
 */
function SlipButtons({ entry }: { entry: EntryDetail }) {
  const [busy, setBusy] = useState(false)
  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator

  const print = async (share: boolean) => {
    setBusy(true)
    try {
      const { exportEntrySlip } = await import('@/lib/stores/export')
      const facts: Array<[string, string]> = []
      if (entry.partyName) facts.push([entry.direction === 'in' ? 'Brought by' : 'Handed to', entry.partyName])
      if (entry.vehicleNo) facts.push(['Vehicle', entry.vehicleNo])
      if (entry.driverName) facts.push(['Driver', entry.driverName])
      if (entry.poWoNo) facts.push(['Purchase order', entry.poWoNo])
      if (entry.handedOverTo) facts.push(['Handed over to', entry.handedOverTo])

      await exportEntrySlip({
        no: entry.no,
        kind: entry.direction === 'in' ? 'Material In' : 'Material Out',
        linked: entry.linkedNo,
        when: formatDateTime(entry.entryAt),
        from: entry.direction === 'out' ? entry.locationName : (entry.partyName ?? null),
        to: entry.direction === 'out' ? (entry.projectName ?? null) : entry.locationName,
        facts,
        lines: entry.lines.map(l => ({ name: l.itemName, qty: l.qty, unit: l.unit })),
        // The map's own three, in its own order.
        signatures: ['Sign of Security', 'Sign of SRM Incharge', 'Sign of Receiver'],
      }, share)
    } finally { setBusy(false) }
  }

  if (entry.lines.length === 0) return null

  return (
    <div className="flex gap-2">
      <Btn kind="ghost" busy={busy} onClick={() => print(false)}>Print slip</Btn>
      {canShare && <Btn kind="ghost" busy={busy} onClick={() => print(true)}>Share</Btn>}
    </div>
  )
}
