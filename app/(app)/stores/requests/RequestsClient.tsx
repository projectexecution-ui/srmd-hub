'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { raiseRequest, decideRequest, issueRequest } from '@/lib/stores/actions'
import {
  checkIssue, bestIssueLocation, fmtQty, approverLabel, RETURNABLES_ON, type StockRow,
} from '@/lib/stores/core'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { RequestRow, ProjectOpt } from '@/lib/stores/queries'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ISSUE_SLOTS, missingPhotos } from '@/lib/stores/photos'
import { PhotoCapture, type Shot } from '../PhotoCapture'
import { uploadEntryPhotos } from '../upload-photos'
import {
  Field, inputClass, Btn, Notice, Empty, Section, StatusChip, Scroller, th, thNum, td, tdNum, GroupedOptions,
} from '../ui'

interface Opt { id: string; name: string }
interface Line { key: string; itemId: string; unit: string; qty: string; returnable: boolean }

let seq = 0
const newLine = (): Line => ({ key: `r${++seq}`, itemId: '', unit: '', qty: '', returnable: false })

export function RequestsClient({
  requests, projects, items, locations, modes, stock, recentItemIds = [], scopeNote = null,
}: {
  requests: RequestRow[]
  projects: ProjectOpt[]
  items: Array<{ id: string; name: string; unit: string }>
  locations: Array<{ id: string; label: string }>
  modes: Opt[]
  stock: Array<Pick<StockRow, 'itemId' | 'locationId' | 'qty'>>
  /** Items this store handled lately — held at the top of the item picker. */
  recentItemIds?: readonly string[]
  /** Why this person can raise for nothing, when that is the case. */
  scopeNote?: string | null
}) {
  const router = useRouter()
  const rows: StockRow[] = stock.map(s => ({ ...s, lastRate: null }))

  return (
    <div className="space-y-6">
      <Section
        title="Step 3 · An engineer asks for material"
        note="Stock is shown while asking, so nobody requests what is not there"
      >
        {projects.length === 0
          ? <Notice kind="info">{scopeNote ?? 'You are not on any project yet, so there is nothing to ask for.'}</Notice>
          : <RaiseForm projects={projects} items={items} stock={rows} recentItemIds={recentItemIds} onDone={() => router.refresh()} />}
      </Section>

      <Section title="Requests">
        {requests.length === 0 ? (
          <Empty title="No requests here" hint="Raise one above and it will appear for approval." />
        ) : (
          <div className="space-y-3">
            {requests.map(r => (
              <RequestCard key={r.id} req={r} locations={locations} modes={modes} stock={rows}
                onDone={() => router.refresh()} />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

/* ── Raise ──────────────────────────────────────────────────────────────── */

function RaiseForm({
  projects, items, stock, recentItemIds, onDone,
}: {
  projects: ProjectOpt[]; items: Array<{ id: string; name: string; unit: string }>
  stock: StockRow[]; recentItemIds: readonly string[]; onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  // One site means there is no question to ask — most engineers are on one.
  const [projectId, setProjectId] = useState(projects.length === 1 ? projects[0].id : '')
  const [fromProjectId, setFromProjectId] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const itemOptions = useMemo(
    () => items.map(i => ({ id: i.id, label: i.name, hint: i.unit })),
    [items],
  )

  const held = (itemId: string) => stock.filter(s => s.itemId === itemId && s.qty > 0)

  if (!open) return <Btn onClick={() => { setOpen(true); setResult(null) }}>Raise a request</Btn>

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 max-w-2xl space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="For which project" required>
          <select className={inputClass} value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Pick one</option>
            <GroupedOptions rows={projects} />
          </select>
        </Field>
        <Field label="Borrowing from another project?" hint="Leave blank for a normal issue from the warehouse.">
          <select className={inputClass} value={fromProjectId} onChange={e => setFromProjectId(e.target.value)}>
            <option value="">No — from the store</option>
            <GroupedOptions rows={projects.filter(p => p.id !== projectId)} />
          </select>
        </Field>
      </div>

      {fromProjectId && RETURNABLES_ON && (
        <Notice kind="info">
          Borrowed material is always marked returnable — it belongs to the other project and has to go back.
        </Notice>
      )}

      <div className="space-y-2">
        {lines.map(l => {
          const where = held(l.itemId)
          const total = where.reduce((s, w) => s + w.qty, 0)
          return (
            <div key={l.key} className="rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="grid sm:grid-cols-[2fr_1fr_1fr] gap-2">
                <Field label="Item">
                  <SearchableSelect
                    value={l.itemId}
                    onChange={id => {
                      const it = items.find(i => i.id === id)
                      setLine(l.key, { itemId: id, unit: it?.unit ?? '' })
                    }}
                    options={itemOptions}
                    pinned={recentItemIds}
                    placeholder="Type three letters"
                    emptyText="No item by that name"
                  />
                </Field>
                <Field label="Qty">
                  <input className={inputClass} value={l.qty} inputMode="decimal"
                    onChange={e => setLine(l.key, { qty: e.target.value })} />
                </Field>
                <Field label="Unit">
                  <input className={inputClass} value={l.unit} onChange={e => setLine(l.key, { unit: e.target.value })} />
                </Field>
              </div>

              {l.itemId && (
                <p className={`text-[12px] ${total > 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                  {total > 0
                    ? <><b>In stock: {fmtQty(total)} {l.unit}</b> — {where.length} place{where.length === 1 ? '' : 's'}</>
                    : <>Nothing in stock. It has to come in through the gate before it can be issued.</>}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {RETURNABLES_ON && (
                  <label className="inline-flex items-center gap-2 text-[12.5px] text-gray-700 min-h-[44px]">
                    <input type="checkbox" className="h-5 w-5 accent-indigo-700"
                      checked={l.returnable || !!fromProjectId} disabled={!!fromProjectId}
                      onChange={e => setLine(l.key, { returnable: e.target.checked })} />
                    Must come back
                  </label>
                )}
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}
                    className="text-[12px] text-rose-700 hover:underline min-h-[44px]">Remove</button>
                )}
              </div>
            </div>
          )
        })}
        <button type="button" onClick={() => setLines(ls => [...ls, newLine()])}
          className="text-[12.5px] font-semibold text-indigo-700 hover:underline min-h-[44px]">
          + Add another item
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Needed by">
          <input type="date" className={inputClass} value={neededBy} onChange={e => setNeededBy(e.target.value)} />
        </Field>
        <Field label="Remarks">
          <input className={inputClass} value={remarks} onChange={e => setRemarks(e.target.value)} />
        </Field>
      </div>

      {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

      <div className="flex flex-wrap gap-2">
        <Btn
          busy={pending}
          onClick={() => start(async () => {
            const r = await raiseRequest({
              projectId, fromProjectId: fromProjectId || null, neededBy: neededBy || null, remarks,
              lines: lines.filter(l => l.itemId && Number(l.qty) > 0)
                .map(l => ({ itemId: l.itemId, unit: l.unit || 'Nos', qty: Number(l.qty), returnable: l.returnable })),
            })
            setResult(r)
            if (r.ok) { setLines([newLine()]); setRemarks(''); onDone() }
          })}
        >
          Send to Mayank / Kanti
        </Btn>
        <Btn kind="ghost" onClick={() => { setOpen(false); setResult(null) }}>Cancel</Btn>
      </div>
    </div>
  )
}

/* ── One request ────────────────────────────────────────────────────────── */

function RequestCard({
  req, locations, modes, stock, onDone,
}: {
  req: RequestRow; locations: Array<{ id: string; label: string }>; modes: Opt[]
  stock: StockRow[]; onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [note, setNote] = useState('')
  const [issuing, setIssuing] = useState(false)
  // Start at the store that actually holds this request. The screen already
  // knows — it prints "140 is held in another location" under the line — so
  // making the storekeeper go and find that place by hand is asking them to
  // act on information already in front of them.
  const [locationId, setLocationId] = useState(() => {
    if (locations.length === 1) return locations[0].id
    const best = bestIssueLocation(stock, req.lines.map(l => ({
      itemId: l.itemId, qty: Math.max(0, l.qty - l.issuedQty),
    })))
    return best && locations.some(l => l.id === best) ? best : ''
  })
  const [modeId, setModeId] = useState('')
  const [handedTo, setHandedTo] = useState('')
  const [shots, setShots] = useState<Shot[]>([])

  // "Item Pics" on SRM Out, and Security's video check before loading — both
  // named in the mind map. The video is optional until there are Security
  // accounts to record it; the photograph is not.
  const shotCounts = shots.reduce<Record<string, number>>(
    (acc, sh) => ({ ...acc, [sh.kind]: (acc[sh.kind] ?? 0) + 1 }), {})
  const missingShots = missingPhotos(ISSUE_SLOTS, shotCounts)
  const [qtys, setQtys] = useState<Record<string, string>>(
    Object.fromEntries(req.lines.map(l => [l.id, String(Math.max(0, l.qty - l.issuedQty))])),
  )

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[13px] font-bold text-gray-900">{req.no}</span>
        <StatusChip status={req.status} />
        {req.status === 'pending' && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-900">
            {approverLabel(req.approvers)}
          </span>
        )}
        <span className="text-[12.5px] text-gray-700">{req.projectName}</span>
        {req.fromProjectName && (
          <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-teal-900">
            borrowing from {req.fromProjectName}
          </span>
        )}
        <span className="ml-auto text-[11.5px] text-gray-400">
          {req.raisedByName ?? 'Someone'} · {formatDateTime(req.raisedAt)}
        </span>
      </div>

      <Scroller min={560}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Item</th>
              <th className={thNum}>Asked</th>
              <th className={thNum}>Issued</th>
              {RETURNABLES_ON && <th className={th}>Returnable</th>}
              {issuing && <th className={thNum}>Issue now</th>}
            </tr>
          </thead>
          <tbody>
            {req.lines.map(l => {
              const check = issuing && locationId
                ? checkIssue(stock, l.itemId, locationId, Number(qtys[l.id] || 0))
                : null
              return (
                <tr key={l.id}>
                  <td className={td}>
                    {l.itemName}
                    {check && !check.ok && <p className="text-[11.5px] text-rose-700 mt-0.5">{check.reason}</p>}
                  </td>
                  <td className={tdNum}>{fmtQty(l.qty)} {l.unit}</td>
                  <td className={tdNum}>{l.issuedQty > 0 ? fmtQty(l.issuedQty) : '—'}</td>
                  {RETURNABLES_ON && (
                    <td className={td}>
                      {l.returnable
                        ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-900">Yes</span>
                        : <span className="text-gray-400 text-[12px]">No</span>}
                    </td>
                  )}
                  {issuing && (
                    <td className={td}>
                      <input className={`${inputClass} w-24 text-right`} value={qtys[l.id] ?? ''} inputMode="decimal"
                        onChange={e => setQtys(q => ({ ...q, [l.id]: e.target.value }))} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Scroller>

      {req.remarks && <p className="px-4 py-2 text-[12.5px] text-gray-600 border-t border-gray-100">{req.remarks}</p>}
      {req.neededBy && (
        <p className="px-4 pb-2 text-[12px] text-gray-500">Needed by {formatDate(req.neededBy)}</p>
      )}
      {req.decisionNote && (
        <p className="px-4 py-2 text-[12.5px] text-gray-700 bg-gray-50 border-t border-gray-100">
          <b>{req.decidedByName ?? 'Approver'}:</b> {req.decisionNote}
        </p>
      )}

      <div className="px-4 py-3 border-t border-gray-100 space-y-3">
        {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

        {req.status === 'pending' && (
          <div className="space-y-2">
            <Field label="Note" hint="Required when rejecting — the engineer needs to know what to do instead.">
              <input className={inputClass} value={note} onChange={e => setNote(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Btn busy={pending} onClick={() => start(async () => {
                const r = await decideRequest(req.id, true, note); setResult(r); if (r.ok) onDone()
              })}>Approve</Btn>
              <Btn kind="danger" busy={pending} onClick={() => start(async () => {
                const r = await decideRequest(req.id, false, note); setResult(r); if (r.ok) onDone()
              })}>Reject</Btn>
            </div>
          </div>
        )}

        {req.status === 'approved' && (
          issuing ? (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Out of which store" required>
                  <select className={inputClass} value={locationId} onChange={e => setLocationId(e.target.value)}>
                    <option value="">Pick a place</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </Field>
                <Field label="Delivery mode">
                  <select className={inputClass} value={modeId} onChange={e => setModeId(e.target.value)}>
                    <option value="">Pick one</option>
                    {modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </Field>
                <Field label="Handed over to">
                  <input className={inputClass} value={handedTo} onChange={e => setHandedTo(e.target.value)} />
                </Field>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 space-y-4">
                {ISSUE_SLOTS.map(slot => (
                  <PhotoCapture
                    key={slot.kind} slot={slot} shots={shots} onChange={setShots} disabled={pending}
                  />
                ))}
              </div>

              {missingShots.length > 0 && (
                <Notice kind="bad">Still needed: {missingShots.join(' · ')}</Notice>
              )}

              <div className="flex flex-wrap gap-2">
                <Btn
                  busy={pending}
                  onClick={() => start(async () => {
                    const r = await issueRequest({
                      requestId: req.id, locationId, deliveryModeId: modeId || null, handedOverTo: handedTo,
                      lines: req.lines
                        .filter(l => Number(qtys[l.id] || 0) > 0)
                        .map(l => ({ requestLineId: l.id, itemId: l.itemId, unit: l.unit, qty: Number(qtys[l.id]), returnable: l.returnable })),
                    })
                    if (!r.ok || !r.data) { setResult(r); return }

                    const up = await uploadEntryPhotos(r.data.id, shots.map(sh => ({ kind: sh.kind, file: sh.file })))
                    setResult(up.failed > 0
                      ? { ok: true, message: `${r.message} ${up.failed} photo${up.failed === 1 ? '' : 's'} did not upload.` }
                      : r)
                    setIssuing(false); onDone()
                  })}
                  disabled={missingShots.length > 0}
                >
                  Issue &amp; take out of stock
                </Btn>
                <Btn kind="ghost" onClick={() => setIssuing(false)}>Cancel</Btn>
              </div>
              <p className="text-[11.5px] text-gray-500">
                Leaving a quantity short issues part of it — the request stays open for the rest.
              </p>
            </div>
          ) : (
            <Btn onClick={() => { setIssuing(true); setResult(null) }}>Issue this</Btn>
          )
        )}
      </div>
    </div>
  )
}
