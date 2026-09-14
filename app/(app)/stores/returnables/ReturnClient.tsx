'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Undo2 } from 'lucide-react'
import { returnItems } from '@/lib/stores/actions'
import { checkReturn, fmtQty, CHASE_AFTER_DAYS, type ReturnableRow } from '@/lib/stores/core'
import { formatDate } from '@/lib/utils'
import { Field, inputClass, Btn, Notice, Empty, Scroller, th, td, tdNum } from '../ui'

/**
 * Still to come back — and, now, the way to clear it.
 *
 * The list was a one-way street: a debt could be created and never settled, so
 * it only ever grew. A chase-list that cannot be ticked off stops being read
 * within a month, which would have taken the whole returnables idea with it.
 *
 * Returns are entered per LINE against one gate entry, because that is how
 * material actually comes back — half the props this week, the rest next.
 */
export function ReturnClient({
  rows, modes,
}: {
  rows: ReturnableRow[]
  modes: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [openEntry, setOpenEntry] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <Empty
        title="Nothing is out on loan"
        hint="A line becomes a debt the moment it is ticked “must come back” — on a vendor delivery, or on material issued from the store."
      />
    )
  }

  // Grouped by the entry they came in on: one truck's worth goes back together.
  const byEntry = new Map<string, ReturnableRow[]>()
  for (const r of rows) byEntry.set(r.entryId, [...(byEntry.get(r.entryId) ?? []), r])

  return (
    <div className="space-y-4">
      <Scroller min={820}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Item</th>
              <th className={th}>Held by</th>
              <th className={th}>Owed to</th>
              <th className={`${th} text-right`}>Out</th>
              <th className={`${th} text-right`}>Back</th>
              <th className={`${th} text-right`}>Still out</th>
              <th className={th}>Since</th>
              <th className={th}>Entry</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.lineId}>
                <td className={td}>{r.itemName}</td>
                <td className={td}>{r.heldBy}</td>
                <td className={td}>{r.owedTo}</td>
                <td className={tdNum}>{fmtQty(r.qty)} {r.unit}</td>
                <td className={tdNum}>{r.returned > 0 ? fmtQty(r.returned) : '—'}</td>
                <td className={`${tdNum} font-bold ${r.days > CHASE_AFTER_DAYS ? 'text-rose-700' : 'text-amber-800'}`}>
                  {fmtQty(r.outstanding)}
                </td>
                <td className={td}>
                  {formatDate(r.since)}
                  <span className={`block text-[11px] ${r.days > CHASE_AFTER_DAYS ? 'text-rose-600 font-semibold' : 'text-gray-400'}`}>
                    {r.days} day{r.days === 1 ? '' : 's'}
                  </span>
                </td>
                <td className={`${td} font-mono text-[12px] text-gray-500`}>{r.entryNo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>

      <div className="space-y-3">
        {[...byEntry.entries()].map(([entryId, lines]) => (
          <div key={entryId} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 flex flex-wrap items-center gap-2.5 border-b border-gray-100">
              <span className="font-mono text-[13px] font-bold text-gray-900">{lines[0].entryNo}</span>
              <span className="text-[12.5px] text-gray-600">
                {lines.length} line{lines.length === 1 ? '' : 's'} owed to {lines[0].owedTo}
              </span>
              <button
                type="button"
                onClick={() => setOpenEntry(openEntry === entryId ? null : entryId)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2
                  text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 min-h-[44px]"
              >
                <Undo2 className="h-4 w-4" />
                {openEntry === entryId ? 'Close' : 'Record a return'}
              </button>
            </div>
            {openEntry === entryId && (
              <ReturnForm
                rows={rows} lines={lines} entryId={entryId} modes={modes}
                onDone={() => { setOpenEntry(null); router.refresh() }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ReturnForm({
  rows, lines, entryId, modes, onDone,
}: {
  rows: ReturnableRow[]
  lines: ReturnableRow[]
  entryId: string
  modes: Array<{ id: string; name: string }>
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [handedTo, setHandedTo] = useState('')
  const [modeId, setModeId] = useState('')
  const [remarks, setRemarks] = useState('')
  // Pre-filled with everything outstanding: most returns are "all of it back",
  // and the exception is easier to edit down than to type up.
  const [qtys, setQtys] = useState<Record<string, string>>(
    Object.fromEntries(lines.map(l => [l.lineId, String(l.outstanding)])),
  )

  return (
    <div className="p-4 space-y-3 bg-gray-50/60">
      {lines.map(l => {
        const qty = Number(qtys[l.lineId] || 0)
        const check = qty > 0 ? checkReturn(rows, l.lineId, qty) : null
        return (
          <div key={l.lineId} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <p className="text-[13.5px] font-semibold text-gray-900">{l.itemName}</p>
              <p className="text-[12px] text-gray-500">{fmtQty(l.outstanding)} {l.unit} still out</p>
            </div>
            <label className="block">
              <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">Coming back</span>
              <input
                className={`${inputClass} w-28 text-right`} value={qtys[l.lineId] ?? ''} inputMode="decimal"
                onChange={e => setQtys(q => ({ ...q, [l.lineId]: e.target.value }))}
              />
            </label>
            {check && !check.ok && (
              <p className="w-full text-[12px] text-rose-700">{check.reason}</p>
            )}
          </div>
        )
      })}

      <div className="grid sm:grid-cols-3 gap-3 pt-1">
        <Field label="Given back to"><input className={inputClass} value={handedTo} onChange={e => setHandedTo(e.target.value)} /></Field>
        <Field label="How it went">
          <select className={inputClass} value={modeId} onChange={e => setModeId(e.target.value)}>
            <option value="">—</option>
            {modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Remarks"><input className={inputClass} value={remarks} onChange={e => setRemarks(e.target.value)} /></Field>
      </div>

      {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

      <Btn
        busy={pending}
        onClick={() => start(async () => {
          const r = await returnItems({
            entryId,
            handedOverTo: handedTo, deliveryModeId: modeId || null, remarks,
            lines: lines
              .filter(l => Number(qtys[l.lineId] || 0) > 0)
              .map(l => ({ lineId: l.lineId, itemId: l.itemId, unit: l.unit, qty: Number(qtys[l.lineId]) })),
          })
          setResult(r)
          if (r.ok) onDone()
        })}
      >
        Record the return
      </Btn>
      <p className="text-[11.5px] text-gray-500">
        Recorded as an OUT linked back to {lines[0].entryNo}, the way the mind map writes it. It does not touch
        stock — a vendor&rsquo;s material was never ours, and anything issued from the store already left it.
      </p>
    </div>
  )
}
