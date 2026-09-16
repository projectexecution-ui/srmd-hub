'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { raiseRequest, decideRequest, issueRequest } from '@/lib/stores/actions'
import {
  checkIssue, bestIssueLocation, fmtQty, approverLabel, approversForRequest,
  RETURNABLES_ON, type StockRow,
} from '@/lib/stores/core'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { RequestRow, ProjectOpt } from '@/lib/stores/queries'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { daysSince, daysOverdue, overdueWord, waitedFor } from '@/lib/stores/desk'
import { ISSUE_SLOTS, missingPhotos } from '@/lib/stores/photos'
import { PhotoCapture, type Shot } from '../PhotoCapture'
import { uploadEntryPhotos } from '../upload-photos'
import {
  Field, inputClass, Btn, Notice, Empty, Section, StatusChip, Scroller, NumberInput,
  th, thNum, td, tdNum, GroupedOptions,
} from '../ui'

interface Opt { id: string; name: string }
interface Line { key: string; itemId: string; unit: string; qty: string; returnable: boolean }

let seq = 0
const newLine = (): Line => ({ key: `r${++seq}`, itemId: '', unit: '', qty: '', returnable: false })

export function RequestsClient({
  requests, projects, items, locations, modes, stock, recentItemIds = [], scopeNote = null,
  mode = 'ask', crossProject = false,
}: {
  requests: RequestRow[]
  projects: ProjectOpt[]
  items: Array<{ id: string; name: string; unit: string; disciplineCode?: string | null }>
  locations: Array<{ id: string; label: string }>
  modes: Opt[]
  stock: Array<Pick<StockRow, 'itemId' | 'locationId' | 'qty'>>
  /** Items this store handled lately — held at the top of the item picker. */
  recentItemIds?: readonly string[]
  /** Why this person can raise for nothing, when that is the case. */
  scopeNote?: string | null
  /**
   * Which job this screen is doing. Aksha, 16 Sep 2026: "i would like Issue as
   * a seperate section ( of Storekeeper so its easy to make out" — one screen
   * was asking, approving AND handing out, which is three jobs and three
   * different people.
   *
   * A flag rather than a second component on purpose: the issue form carries
   * the stock checks, and a copy of those is a copy that drifts.
   */
  mode?: 'ask' | 'issue'
  /** Whether borrowing from another project family is switched on — the live
   *  setting from Masters, not a constant. */
  crossProject?: boolean
}) {
  const router = useRouter()
  const rows: StockRow[] = stock.map(s => ({ ...s, lastRate: null, lastMovedAt: null }))

  return (
    <div className="space-y-6">
      {mode === 'ask' && (
      <Section
        title="Ask for material"
        note="Stock is shown while asking, so nobody requests what is not there"
      >
        {projects.length === 0
          ? <Notice kind="info">{scopeNote ?? 'You are not on any project yet, so there is nothing to ask for.'}</Notice>
          : <RaiseForm projects={projects} items={items} stock={rows} locations={locations}
              recentItemIds={recentItemIds} crossProject={crossProject}
              onDone={() => router.refresh()} />}
      </Section>
      )}

      <Section title={mode === 'issue' ? 'Approved, waiting to go out' : 'Your requests'}>
        {requests.length === 0 ? (
          <Empty title="No requests here" hint="Raise one above and it will appear for approval." />
        ) : (
          <div className="space-y-3">
            {requests.map(r => (
              <RequestCard key={r.id} req={r} locations={locations} modes={modes} stock={rows}
                mode={mode} onDone={() => router.refresh()} />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

/* ── Raise ──────────────────────────────────────────────────────────────── */

function RaiseForm({
  projects, items, stock, locations, recentItemIds, crossProject, onDone,
}: {
  projects: ProjectOpt[]; items: Array<{ id: string; name: string; unit: string; disciplineCode?: string | null }>
  stock: StockRow[]; locations: Array<{ id: string; label: string }>
  recentItemIds: readonly string[]; crossProject: boolean; onDone: () => void
}) {
  const placeName = (id: string | null) =>
    locations.find(l => l.id === id)?.label ?? 'an unnamed place'
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

  /**
   * Only what this project actually holds.
   *
   * Aksha, 16 Sep 2026: "Also the Items of that project only show up". It is
   * also the mind map's hardest rule — "Item can be picked up ONLY from stock
   * Items" — so offering all 660 was offering 650 an engineer cannot have.
   *
   * The stock handed to this component is already scoped to the sites they are
   * on, so "held" here means held somewhere they can draw from.
   */
  /** Where an item sits, short enough for a dropdown's second line. */
  const whereShort = (itemId: string) => {
    const at = stock.filter(r => r.itemId === itemId && r.qty > 0)
    if (at.length === 0) return 'nowhere'
    if (at.length === 1) return placeName(at[0].locationId)
    return `${at.length} places`
  }

  const itemOptions = useMemo(() => {
    const held = new Map<string, number>()
    for (const r of stock) {
      if (r.qty > 0) held.set(r.itemId, (held.get(r.itemId) ?? 0) + r.qty)
    }
    return items
      .filter(i => held.has(i.id))
      .map(i => ({
        id: i.id,
        label: i.name,
        // How much there is, on the line where it is being chosen.
        hint: `${fmtQty(held.get(i.id) ?? 0)} ${i.unit} · ${whereShort(i.id)}`,
      }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, stock, locations])

  const held = (itemId: string) => stock.filter(s => s.itemId === itemId && s.qty > 0)

  if (!open) return <Btn onClick={() => { setOpen(true); setResult(null) }}>Raise a request</Btn>

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 max-w-2xl space-y-3">
      <div className={`grid gap-3 ${crossProject ? 'sm:grid-cols-2' : ''}`}>
        <Field label="For which project" required>
          <select className={inputClass} value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Pick one</option>
            <GroupedOptions rows={projects} />
          </select>
        </Field>
        {/* Borrowing from another project is paused — the HOD has not settled
            the process — so an engineer is not asked about it at all. */}
        {crossProject && (
          <Field label="Borrowing from another project?" hint="Leave blank for a normal issue from the warehouse.">
            <select className={inputClass} value={fromProjectId} onChange={e => setFromProjectId(e.target.value)}>
              <option value="">No — from the store</option>
              <GroupedOptions rows={projects.filter(p => p.id !== projectId)} />
            </select>
          </Field>
        )}
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
                    placeholder={itemOptions.length ? 'Type three letters' : 'Nothing in your stores yet'}
                    emptyText="Not in your stores — it has to come in through the gate first"
                  />
                </Field>
                <Field label="Qty">
                  <NumberInput value={l.qty} onChange={v => setLine(l.key, { qty: v })} />
                </Field>
                <Field label="Unit">
                  <input className={inputClass} value={l.unit} onChange={e => setLine(l.key, { unit: e.target.value })} />
                </Field>
              </div>

              {l.itemId && (
                <p className={`text-[12px] ${total > 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                  {total > 0
                    ? (
                      <>
                        <b>In stock: {fmtQty(total)} {l.unit}</b>
                        {/* NAME the shelf. "1 place" told an engineer there was
                            one and not which — and the point of asking is to go
                            and collect it. Aksha, 16 Sep 2026: "the name of the
                            place should come so the Engineer knows the Exact
                            location". */}
                        {' — '}
                        {where.map((w, n) => (
                          <span key={w.locationId ?? n}>
                            {n > 0 && ' · '}
                            {where.length > 1 && <>{fmtQty(w.qty)} at </>}
                            <b>{placeName(w.locationId)}</b>
                          </span>
                        ))}
                      </>
                    )
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
          Send to {approverLabel(approversForRequest(
            lines.filter(l => l.itemId).map(l => items.find(i => i.id === l.itemId)?.disciplineCode ?? null),
          ))}
        </Btn>
        <Btn kind="ghost" onClick={() => { setOpen(false); setResult(null) }}>Cancel</Btn>
      </div>
    </div>
  )
}

/** One fact on a request card. Shows the gap rather than hiding it — an
 *  approver needs to know what was NOT said as much as what was. */
function Fact({
  label, value, empty = '—', tone,
}: { label: string; value: string | null; empty?: string; tone?: 'bad' }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className={`mt-0.5 text-[12.5px] ${
        value ? 'text-gray-900' : tone === 'bad' ? 'font-semibold text-rose-700' : 'text-gray-400'
      }`}>
        {value ?? empty}
      </dd>
    </div>
  )
}

/* ── One request ────────────────────────────────────────────────────────── */

function RequestCard({
  req, locations, modes, stock, mode, onDone,
}: {
  req: RequestRow; locations: Array<{ id: string; label: string }>; modes: Opt[]
  stock: StockRow[]; mode: 'ask' | 'issue'; onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [note, setNote] = useState('')
  const [issuing, setIssuing] = useState(false)
  // Only a request somebody still has to act on has "been waiting" — a closed
  // one waited once, and saying so now is history, not a prompt.
  const open = req.status === 'pending' || req.status === 'approved'
  const waiting = open ? daysSince(req.raisedAt) : null
  const late = open ? overdueWord(daysOverdue(req.neededBy)) : null
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
        {/* How long it has been sitting there. Every pending card looked
            identical whether it was raised an hour ago or nine days ago —
            Aksha, 16 Sep 2026, 11. */}
        {waiting != null && (
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
            waiting >= 3 ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-600'
          }`}>
            waiting {waitedFor(waiting)}
          </span>
        )}
        {late != null && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-bold text-rose-800">
            needed {formatDate(req.neededBy!)} — {late}
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
                      <NumberInput className="w-24 text-right" ariaLabel={`Issue ${l.itemName}`}
                        value={qtys[l.id] ?? ''} onChange={v => setQtys(q => ({ ...q, [l.id]: v }))} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Scroller>

      {/* Everything the approver needs, without opening anything else.
          Aksha, 16 Sep 2026: "which project and which warehouse and where will
          it be used - all data should show to the approver". Saying yes to
          4,111 SqFt the store does not hold is a promise nobody can keep, and
          the storekeeper is the one who finds out. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 px-4 py-3 sm:grid-cols-4">
        <Fact label="For which project" value={req.projectName} />
        <Fact
          label="Out of which store"
          value={req.heldAt.length === 0
            ? null
            : req.heldAt.map(h => h.label).join(' · ')}
          tone={req.heldAt.length === 0 ? 'bad' : undefined}
          empty="Not in any store — cannot be issued"
        />
        <Fact label="What it is for" value={req.remarks} empty="not said" />
        <Fact
          label="Needed by"
          value={req.neededBy ? formatDate(req.neededBy) : null}
          empty="no date"
          tone={late ? 'bad' : undefined}
        />
      </dl>

      <Timeline req={req} />

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

        {req.status === 'approved' && mode === 'issue' && (
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

/**
 * Where a request has got to: raised → approved → issued → received.
 *
 * Four steps, each with a name and a date, and the ones that have not happened
 * shown as hollow rather than hidden. Aksha, 16 Sep 2026: "The request card
 * tells the time". A status word says where it IS; this says how it got there
 * and what is left — which is the question an engineer actually opens the
 * screen with.
 */
function Timeline({ req }: { req: RequestRow }) {
  const steps: Array<{ label: string; who: string | null; at: string | null; done: boolean; now?: boolean }> = [
    { label: 'Raised', who: req.raisedByName, at: req.raisedAt, done: true },
    {
      label: req.status === 'rejected' ? 'Rejected' : 'Approved',
      who: req.decidedByName ?? (req.status === 'pending' ? approverLabel(req.approvers) : null),
      at: req.decidedAt,
      done: !!req.decidedAt,
      now: req.status === 'pending',
    },
    {
      label: 'Issued',
      who: req.issuedEntryNo,
      at: req.issuedAt,
      done: !!req.issuedAt,
      now: req.status === 'approved',
    },
    {
      label: 'Received',
      who: req.receivedBy,
      at: req.receivedAt,
      done: !!req.receivedAt,
      now: !!req.issuedAt && !req.receivedAt,
    },
  ]

  // A rejected request never goes any further, and drawing two hollow steps
  // after it suggests it is still on its way.
  const shown = req.status === 'rejected' ? steps.slice(0, 2) : steps

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-gray-100 px-4 py-2.5 text-[11.5px]">
      {shown.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-gray-300">→</span>}
          <span className={
            s.now ? 'font-semibold text-amber-800'
              : s.done ? 'text-gray-700'
                : 'text-gray-400'
          }>
            <span aria-hidden className="mr-1">{s.done ? '●' : '○'}</span>
            {s.label}
            {s.at && <> {formatDate(s.at)}</>}
            {s.who && <span className="text-gray-500"> · {s.who}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
