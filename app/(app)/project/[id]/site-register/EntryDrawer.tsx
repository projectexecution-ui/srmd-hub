'use client'

// One entry, opened from the register.
//
// The panel answers four questions in the order a person asks them: what is
// it, who is it with and by when, what has been said, and what was done to it.
//
// The conversation is a TIMELINE with a rail down the left, because an entry
// is a sequence — who said what, in order — and a stack of equal blocks hides
// that. The record of actions at the bottom is what makes this a document
// rather than a chat: every reassignment, revised date and closure is stamped
// and nothing in the app can edit it away.

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { X, Loader2, Paperclip } from 'lucide-react'
import { MentionTextarea } from '@/components/mentions/MentionTextarea'
import { formatDate, formatDateTime, formatINR } from '@/lib/utils'
import {
  KIND_BY_KEY, PRIORITY_LABEL, STATUS_LABEL, daysOverdue, daysWaiting, isLive,
} from '@/lib/site-register/types'
import {
  closeEntry, fetchEntry, reassignEntry, reopenEntry, replyToEntry,
  reviseDueDate, setCostImpact, setWatching,
} from '@/lib/site-register/actions'
import type { PersonOption, ThreadDetail } from '@/lib/site-register/queries'
import { Avatar, Button, Field, FIELD, Label, Notice, Pill, Status, SURFACE } from './ui'

type Panel = 'none' | 'reassign' | 'due' | 'cost' | 'close' | 'reopen'

const EVENT_WORDS: Record<string, string> = {
  raised: 'Raised',
  responded: 'Responded',
  reassigned: 'Reassigned',
  due_date_revised: 'Response date revised',
  cost_impact_set: 'Cost impact recorded',
  closed: 'Closed',
  reopened: 'Reopened',
}

export function EntryDrawer({
  entryId, onClose, onChanged, people, stakeholders, canWrite,
}: {
  entryId: string
  onClose: () => void
  onChanged: () => void
  people: PersonOption[]
  stakeholders: Array<{ id: string; name: string; discipline: string | null }>
  canWrite: boolean
}) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [panel, setPanel] = useState<Panel>('none')
  const [pending, start] = useTransition()

  // Reload after an action. Called from an event handler, never an effect:
  // the drawer is keyed on the entry, so opening a different one mounts a
  // fresh panel rather than mutating this one.
  const load = () => {
    fetchEntry(entryId)
      .then(d => { setDetail(d); setLoading(false) })
      .catch(() => { setError('This entry could not be opened.'); setLoading(false) })
  }
  useEffect(() => {
    let alive = true
    fetchEntry(entryId)
      .then(d => { if (alive) { setDetail(d); setLoading(false) } })
      .catch(() => { if (alive) { setError('This entry could not be opened.'); setLoading(false) } })
    return () => { alive = false }
  }, [entryId])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = '' }
  }, [onClose])

  const after = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) { setError(r.error ?? 'That did not save.'); return }
    setError(null); setPanel('none'); setReply(''); load(); onChanged()
  }

  const row = detail?.row
  const kind = row ? KIND_BY_KEY[row.kind] : null
  const over = row ? daysOverdue(row.dueOn) : 0
  const waiting = row ? daysWaiting(row.assignedAt) : 0
  const watching = !!detail && detail.watchers.some(w => w.id === detail.myId)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Register entry"
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-gray-50 shadow-[0_0_60px_rgba(16,24,40,0.25)] sm:w-[620px] lg:w-[760px]"
      >
        {loading && (
          <div className="grid flex-1 place-items-center text-gray-500">
            <div className="text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mt-2 text-[13px]">Opening…</p>
            </div>
          </div>
        )}

        {!loading && !row && (
          <div className="p-6">
            <p className="text-[14px] font-semibold text-gray-900">This entry could not be opened.</p>
            <Button className="mt-3" onClick={onClose}>Close</Button>
          </div>
        )}

        {row && detail && kind && (
          <>
            {/* ── Identity ─────────────────────────────────────────────── */}
            <header className="shrink-0 border-b border-gray-200 bg-white px-5 py-4">
              <div className="flex items-start gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={kind.tone} strong>{row.ref}</Pill>
                  <Pill tone={kind.tone}>{kind.label}</Pill>
                  {row.priority !== 'normal' && (
                    <Pill tone={row.priority === 'critical' ? 'rose' : row.priority === 'high' ? 'amber' : 'slate'}>
                      {PRIORITY_LABEL[row.priority]}
                    </Pill>
                  )}
                  <Status tone={row.status === 'closed' ? 'emerald' : over > 0 ? 'rose' : row.status === 'responded' ? 'sky' : 'slate'}>
                    {over > 0 && isLive(row.status) ? `Overdue by ${over} day${over === 1 ? '' : 's'}` : STATUS_LABEL[row.status]}
                  </Status>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-gray-900">{row.title}</h3>
              <p className="mt-1 text-[12px] text-gray-500">
                {[row.categoryName, row.subCategoryName].filter(Boolean).join(' › ') || 'No category'}
                {row.location ? ` · ${row.location}` : ''} · raised by {row.raisedByName ?? 'someone'} on {formatDate(row.createdAt)}
              </p>
            </header>

            <div className="flex-1 overflow-y-auto">
              {error && <div className="px-5 pt-4"><Notice>{error}</Notice></div>}

              {/* ── The two facts that matter, side by side ───────────── */}
              <div className="grid gap-2.5 p-5 sm:grid-cols-2">
                <div className={`${SURFACE} p-3.5`}>
                  <Label>Assigned to</Label>
                  <div className="mt-2 flex items-center gap-2.5">
                    <Avatar name={row.assignedToName} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold leading-tight text-gray-900">
                        {row.assignedToName ?? 'Unassigned'}
                      </p>
                      <p className={`text-[11px] ${over > 0 ? 'font-semibold text-rose-700' : 'text-gray-500'}`}>
                        {isLive(row.status)
                          ? `${waiting === 0 ? 'since today' : `${waiting} day${waiting === 1 ? '' : 's'}`}${row.dueOn ? ` · due ${formatDate(row.dueOn)}` : ' · no response date'}`
                          : `${STATUS_LABEL[row.status]} on ${formatDate(row.lastActivityAt)}`}
                      </p>
                    </div>
                  </div>
                </div>
                <div className={`${SURFACE} p-3.5`}>
                  <Label>Cost impact</Label>
                  <p className={`mt-2 text-[20px] font-bold leading-none tabular-nums tracking-[-0.02em] ${row.costImpact ? 'text-amber-800' : 'text-gray-300'}`}>
                    {row.costImpact ? formatINR(row.costImpact) : 'None recorded'}
                  </p>
                  {detail.costNote && <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">{detail.costNote}</p>}
                </div>
              </div>

              {row.escalated && (
                <div className="px-5 pb-1">
                  <Notice tone="amber">
                    <b>Escalated.</b> It passed its response date without an answer, so it also appears on the Atm Head&rsquo;s list.
                  </Notice>
                </div>
              )}

              {/* ── What can be done ─────────────────────────────────── */}
              {canWrite && (
                <div className="px-5 pb-4">
                  <div className="flex flex-wrap gap-1.5">
                    {isLive(row.status) && (
                      <>
                        <Button onClick={() => setPanel(panel === 'reassign' ? 'none' : 'reassign')}>Reassign</Button>
                        <Button onClick={() => setPanel(panel === 'due' ? 'none' : 'due')}>Revise response date</Button>
                      </>
                    )}
                    <Button onClick={() => setPanel(panel === 'cost' ? 'none' : 'cost')}>
                      {row.costImpact ? 'Revise cost impact' : 'Record cost impact'}
                    </Button>
                    {isLive(row.status) && detail.canClose && (
                      <Button onClick={() => setPanel(panel === 'close' ? 'none' : 'close')}>Close</Button>
                    )}
                    {!isLive(row.status) && (
                      <Button onClick={() => setPanel(panel === 'reopen' ? 'none' : 'reopen')}>Reopen</Button>
                    )}
                    {row.costImpact != null && row.costImpact > 0 && (
                      <Link
                        href={`/cost-control/working-sheets/new-quick?project=${row.projectId}`}
                        className="inline-flex min-h-[40px] items-center rounded-lg bg-amber-50 px-3 text-[12px] font-semibold text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
                      >
                        Raise a working sheet
                      </Link>
                    )}
                  </div>
                  {isLive(row.status) && !detail.canClose && (
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      Only {row.raisedByName ?? 'the originator'} can close this — reply to ask for closure.
                    </p>
                  )}

                  {panel !== 'none' && (
                    <div className={`mt-3 ${SURFACE} p-3.5`}>
                      {panel === 'reassign' && (
                        <form className="space-y-2.5" action={(fd: FormData) => start(async () => {
                          const to = String(fd.get('to') ?? '')
                          after(await reassignEntry(row.id,
                            to.startsWith('s:') ? { stakeholderId: to.slice(2) } : { userId: to },
                            String(fd.get('note') ?? '')))
                        })}>
                          <Field label="Reassign to">
                            <select name="to" required className={FIELD}>
                              <option value="">Choose a person or firm…</option>
                              <optgroup label="CT Hub users">
                                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </optgroup>
                              {stakeholders.length > 0 && (
                                <optgroup label="Project stakeholders">
                                  {stakeholders.map(s => (
                                    <option key={s.id} value={`s:${s.id}`}>{s.name}{s.discipline ? ` — ${s.discipline}` : ''}</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </Field>
                          <input name="note" placeholder="Why it is going to them (optional)" className={FIELD} />
                          <Button kind="primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Reassign'}</Button>
                        </form>
                      )}

                      {panel === 'due' && (
                        <form className="space-y-2.5" action={(fd: FormData) => start(async () =>
                          after(await reviseDueDate(row.id, String(fd.get('due') ?? ''), String(fd.get('reason') ?? ''))))}>
                          <Field label="New response date">
                            <input type="date" name="due" required defaultValue={row.dueOn ?? ''} className={FIELD} />
                          </Field>
                          <input name="reason" required placeholder="Why the date is changing — this is recorded" className={FIELD} />
                          <Button kind="primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save the new date'}</Button>
                        </form>
                      )}

                      {panel === 'cost' && (
                        <form className="space-y-2.5" action={(fd: FormData) => start(async () => {
                          const raw = String(fd.get('amount') ?? '').replace(/[^0-9.]/g, '')
                          after(await setCostImpact(row.id, raw ? Number(raw) : null, String(fd.get('note') ?? '')))
                        })}>
                          <Field label="Cost impact" hint="No budget moves from here. It marks the entry so the money is not forgotten when the working sheet is raised.">
                            <input name="amount" inputMode="decimal" defaultValue={row.costImpact ?? ''}
                              placeholder="Amount in rupees — blank to clear" className={`${FIELD} tabular-nums`} />
                          </Field>
                          <input name="note" defaultValue={detail.costNote ?? ''} placeholder="What the figure covers" className={FIELD} />
                          <Button kind="primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
                        </form>
                      )}

                      {panel === 'close' && (
                        <form className="space-y-2.5" action={(fd: FormData) => start(async () =>
                          after(await closeEntry(row.id, String(fd.get('note') ?? ''))))}>
                          <Field label="Close this entry" hint="What settled it — optional, but it is what people read later.">
                            <input name="note" placeholder="How it was settled" className={FIELD} />
                          </Field>
                          <Button kind="primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Close'}</Button>
                        </form>
                      )}

                      {panel === 'reopen' && (
                        <form className="space-y-2.5" action={(fd: FormData) => start(async () =>
                          after(await reopenEntry(row.id, String(fd.get('reason') ?? ''))))}>
                          <Field label="Reopen this entry">
                            <input name="reason" required placeholder="Why it is being reopened" className={FIELD} />
                          </Field>
                          <Button kind="primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Reopen'}</Button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── The conversation, as a timeline ───────────────────── */}
              <div className="px-5 pb-4">
                <Label>Conversation</Label>
                <ol className="mt-2.5 space-y-0">
                  {detail.posts.map((p, i) => {
                    const last = i === detail.posts.length - 1
                    const instruction = row.kind === 'instruction' && i === 0
                    return (
                      <li key={p.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {!last && <span className="absolute left-[13px] top-8 bottom-0 w-px bg-gray-200" aria-hidden />}
                        <Avatar name={p.author} size="md" />
                        <div className={`min-w-0 flex-1 rounded-xl px-3.5 py-2.5 ring-1 ${instruction ? 'bg-violet-50/70 ring-violet-200' : 'bg-white ring-gray-200/80'}`}>
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <p className="text-[13px] font-semibold text-gray-900">{p.author}</p>
                            <p className="text-[11px] text-gray-400">
                              {formatDateTime(p.createdAt)}{p.editedAt ? ' · edited' : ''}
                            </p>
                            {i === 0 && <span className="ml-auto text-[11px] text-gray-400">opened it</span>}
                          </div>
                          <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">{p.body}</p>
                          {p.attachments.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {p.attachments.map((a, j) => (
                                <span key={j} className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-[11px] text-gray-600 ring-1 ring-gray-200">
                                  <Paperclip className="h-3 w-3" /> {a.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>

              {/* ── Reply ────────────────────────────────────────────── */}
              {canWrite && (
                <div className="px-5 pb-4">
                  <div className={`${SURFACE} p-3`}>
                    <MentionTextarea
                      value={reply}
                      onChange={(v, ids) => { setReply(v); setMentions(ids) }}
                      placeholder="Write a reply — type @ to bring someone in"
                      rows={3}
                      maxLength={8000}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      {row.assignedToId === detail.myId && row.raisedById !== detail.myId && (
                        <p className="text-[11px] leading-tight text-gray-500">
                          Replying returns this to {row.raisedByName ?? 'the originator'} as <b>Responded</b>.
                        </p>
                      )}
                      <Button
                        kind="primary"
                        className="ml-auto"
                        disabled={pending || !reply.trim()}
                        onClick={() => start(async () => after(await replyToEntry(row.id, reply, mentions)))}
                      >
                        {pending ? 'Sending…' : 'Send reply'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Distribution and record ──────────────────────────── */}
              <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2">
                <div className={`${SURFACE} p-3.5`}>
                  <Label>Kept informed ({detail.watchers.length})</Label>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {detail.watchers.length
                      ? detail.watchers.map(w => (
                          <span key={w.id} className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 py-0.5 pl-0.5 pr-2 text-[11px] text-gray-700 ring-1 ring-gray-200">
                            <Avatar name={w.name} /> {w.name}
                          </span>
                        ))
                      : <span className="text-[12px] text-gray-400">Nobody beyond the two people above</span>}
                  </div>
                  {detail.myId && (
                    <button
                      onClick={() => start(async () => after(await setWatching(row.id, !watching)))}
                      className="mt-2.5 text-[12px] font-semibold text-indigo-700 hover:underline"
                    >
                      {watching ? 'Stop following this entry' : 'Follow this entry'}
                    </button>
                  )}
                </div>

                <div className={`${SURFACE} p-3.5`}>
                  <Label>Record of actions</Label>
                  <ol className="mt-2 space-y-1.5">
                    {detail.events.map(e => (
                      <li key={e.id} className="text-[12px] leading-snug text-gray-600">
                        <span className="tabular-nums text-gray-400">{formatDateTime(e.createdAt)}</span>
                        {' — '}<b className="font-semibold text-gray-800">{EVENT_WORDS[e.event] ?? e.event}</b>
                        {' by '}{e.actor}{e.detail ? ` — ${e.detail}` : ''}
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-[11px] text-gray-400">Stamped as it happened. Nothing here can be edited or removed.</p>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  )
}
