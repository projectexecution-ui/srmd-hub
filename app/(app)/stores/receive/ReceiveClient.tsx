'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { PackageCheck } from 'lucide-react'
import { confirmReceipt } from '@/lib/stores/actions'
import { fmtQty } from '@/lib/stores/core'
import { daysSince, waitedFor } from '@/lib/stores/desk'
import { RECEIPT_SLOTS, missingPhotos } from '@/lib/stores/photos'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { AwaitingReceipt } from '@/lib/stores/queries'
import { PhotoCapture, type Shot } from '../PhotoCapture'
import { uploadEntryPhotos } from '../upload-photos'
import { Field, inputClass, Btn, Notice, Empty } from '../ui'

/**
 * Signing for material at the site.
 *
 * The map's last two lines of SRM Out — "SRM Engg receives the materails &
 * checks & Signs" and "Capture where the materials are being stored" — were
 * built on 14 Sep and then reachable only from the foot of one entry page, by
 * somebody who already knew the entry number. Not one issue on record has ever
 * been signed for, which is what a step with no list looks like.
 *
 * Aksha, 16 Sep 2026: "Where will the reciever do the entry - i cant see the
 * page or section of the same" and "one more section of Recieved at site ( the
 * Site head recieving cycle (his pic and confirmation and place where he kept)".
 *
 * Oldest first: the load that left four days ago and nobody signed for is the
 * one that matters, not this morning's.
 */
export function ReceiveClient({
  rows, places,
}: {
  rows: AwaitingReceipt[]
  places: Array<{ id: string; label: string }>
}) {
  if (rows.length === 0) {
    return (
      <Empty
        title="Nothing is waiting to be signed for"
        hint="When the storekeeper issues material to your site, it appears here until somebody says it arrived and where it was put."
      />
    )
  }

  return (
    <div className="space-y-3">
      {rows.map(r => <ReceiveCard key={r.id} row={r} places={places} />)}
    </div>
  )
}

function ReceiveCard({
  row, places,
}: {
  row: AwaitingReceipt
  places: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [toLocation, setToLocation] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [note, setNote] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const waiting = daysSince(row.issuedAt)
  const counts = shots.reduce<Record<string, number>>(
    (acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] ?? 0) + 1 }), {})
  const missing = missingPhotos(RECEIPT_SLOTS, counts)

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-gray-100">
        <Link href={`/stores/gate/${row.id}`} className="font-mono text-[13px] font-bold text-indigo-700 hover:underline">
          {row.no}
        </Link>
        {row.requestNo && (
          <span className="text-[12px] text-gray-500">answers {row.requestNo}</span>
        )}
        <span className="text-[12.5px] font-semibold text-gray-800">{row.projectName ?? 'No project'}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
          waiting >= 2 ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'
        }`}>
          waiting {waitedFor(waiting)}
        </span>
        <span className="ml-auto text-[11.5px] text-gray-400">
          left {formatDate(row.issuedAt)}{row.issuedBy ? ` · ${row.issuedBy}` : ''}
        </span>
      </div>

      <ul className="divide-y divide-gray-50">
        {row.lines.map(l => (
          <li key={l.id} className="flex items-baseline gap-3 px-4 py-2">
            <span className="flex-1 text-[13px] text-gray-900">{l.itemName}</span>
            <span className="text-[13px] font-semibold tabular-nums text-gray-900">
              {fmtQty(l.qty)} <span className="font-normal text-gray-400">{l.unit}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="px-4 py-3 border-t border-gray-100">
        <p className="text-[12px] text-gray-500">
          Out of {row.fromLabel ?? 'a store'}
          {row.handedOverTo ? ` · handed to ${row.handedOverTo}` : ''}
        </p>
      </div>

      {!open ? (
        <div className="px-4 pb-4">
          <Btn onClick={() => { setOpen(true); setResult(null) }}>
            <PackageCheck className="h-4 w-4" /> I received this
          </Btn>
        </div>
      ) : (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              label="Where you put it"
              hint="The map's “capture where the materials are being stored” — so the next person can find it."
            >
              <select className={inputClass} value={toLocation} onChange={e => setToLocation(e.target.value)}>
                <option value="">Not recorded</option>
                {places.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Who took delivery" hint="Leave blank if it was you.">
              <input className={inputClass} value={receivedBy} onChange={e => setReceivedBy(e.target.value)} />
            </Field>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            {RECEIPT_SLOTS.map(slot => (
              <PhotoCapture key={slot.kind} slot={slot} shots={shots} onChange={setShots} disabled={pending} />
            ))}
          </div>

          <Field label="Anything to note" hint="Short of what was asked, damaged in transit — say so here.">
            <input className={inputClass} value={note} onChange={e => setNote(e.target.value)} />
          </Field>

          {/* Never a dead button: what is still needed, next to the button. */}
          {missing.length > 0 && <Notice kind="bad">Still needed: {missing.join(' · ')}</Notice>}
          {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

          <div className="flex flex-wrap gap-2">
            <Btn
              busy={pending}
              disabled={missing.length > 0}
              onClick={() => start(async () => {
                const r = await confirmReceipt({
                  entryId: row.id,
                  toLocationId: toLocation || null,
                  receivedBy,
                  note,
                })
                if (!r.ok) { setResult(r); return }
                // The photograph follows the signature. If it fails the
                // signature still stands — the entry is the record.
                const up = await uploadEntryPhotos(row.id, shots.map(s => ({ kind: s.kind, file: s.file })))
                setResult(up.failed > 0
                  ? { ok: true, message: `${r.message} ${up.failed} photo did not upload.` }
                  : r)
                router.refresh()
              })}
            >
              Sign for it
            </Btn>
            <Btn kind="ghost" onClick={() => { setOpen(false); setResult(null) }}>Cancel</Btn>
          </div>

          <p className="text-[11.5px] text-gray-500">
            Your name and the time are stamped on {row.no}, and it closes. Signed on {formatDateTime(new Date().toISOString())}.
          </p>
        </div>
      )}
    </div>
  )
}
