'use client'

// One entry, opened from the register.
//
// The panel answers four questions in the order a person asks them: what is
// it, who is it with and by when, what has been said, and what was done to it.
// The trail at the bottom is the part that makes the register a record rather
// than a chat — every reassignment, revised date and closure is stamped and
// cannot be edited away.

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { X, Loader2 } from 'lucide-react'
import { MentionTextarea } from '@/components/mentions/MentionTextarea'
import { formatDate, formatDateTime, formatINR } from '@/lib/utils'
import {
  KIND_BY_KEY, PRIORITY_LABEL, STATUS_LABEL, daysOverdue, daysWaiting, isLive,
} from '@/lib/site-register/types'
import {
  closeEntry, fetchEntry, reassignEntry, reopenEntry, replyToEntry,
  reviseDueDate, setCostImpact, setWatching,
} from '@/lib/site-register/actions'
import type { ThreadDetail } from '@/lib/site-register/queries'
import type { PersonOption } from '@/lib/site-register/queries'
import { Pill, Who } from './ui'

type Panel = 'none' | 'reassign' | 'due' | 'cost' | 'close' | 'reopen'

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

  // Reload after an action. Called from an event handler, never from an
  // effect: the drawer is keyed on the entry, so opening a different one
  // mounts a fresh panel rather than mutating this one.
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

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/40 z-40" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Register entry"
        className="fixed top-0 right-0 h-full w-full sm:w-[560px] bg-white z-50 shadow-2xl overflow-y-auto"
      >
        {loading && (
          <div className="p-10 text-center text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            <p className="text-[13px] mt-2">Opening…</p>
          </div>
        )}

        {!loading && !row && (
          <div className="p-6">
            <p className="text-sm font-semibold text-gray-900">This entry could not be opened.</p>
            <button onClick={onClose} className="mt-3 text-[13px] font-semibold text-indigo-700">Close</button>
          </div>
        )}

        {row && detail && kind && (
          <>
            {/* ── Identity ─────────────────────────────────────────────── */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 z-10">
              <div className="flex items-start gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={kind.tone} strong>{row.ref}</Pill>
                  <Pill tone={kind.tone}>{kind.label}</Pill>
                  {row.priority !== 'normal' && (
                    <Pill tone={row.priority === 'critical' ? 'rose' : row.priority === 'high' ? 'amber' : 'slate'}>
                      {PRIORITY_LABEL[row.priority]}
                    </Pill>
                  )}
                  <Pill tone={row.status === 'closed' ? 'emerald' : over > 0 ? 'rose' : 'slate'}>
                    {over > 0 && isLive(row.status) ? `Overdue by ${over} day${over === 1 ? '' : 's'}` : STATUS_LABEL[row.status]}
                  </Pill>
                </div>
                <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 p-1 min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <h3 className="text-[15px] font-bold text-gray-900 mt-2 leading-snug">{row.title}</h3>
              <p className="text-[12px] text-gray-500 mt-0.5">
                {[row.categoryName, row.subCategoryName].filter(Boolean).join(' › ') || 'No category'}
                {row.location ? ` · ${row.location}` : ''}
                {' · raised by '}{row.raisedByName ?? 'someone'}{' on '}{formatDate(row.createdAt)}
              </p>
            </div>

            {error && (
              <div className="mx-4 mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</div>
            )}

            {/* ── Responsibility and money ─────────────────────────────── */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Assigned to</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Who name={row.assignedToName} size="md" />
                    <div>
                      <p className="text-[13px] font-bold text-gray-900 leading-tight">{row.assignedToName ?? 'Unassigned'}</p>
                      <p className={`text-[11px] ${over > 0 ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                        {isLive(row.status)
                          ? `${waiting === 0 ? 'since today' : `${waiting} day${waiting === 1 ? '' : 's'}`}${row.dueOn ? ` · response due ${formatDate(row.dueOn)}` : ' · no response date'}`
                          : `${STATUS_LABEL[row.status]} on ${formatDate(row.lastActivityAt)}`}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="ml-auto">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Cost impact</p>
                  <p className={`text-[15px] font-bold tabular-nums mt-0.5 ${row.costImpact ? 'text-amber-800' : 'text-gray-400'}`}>
                    {row.costImpact ? formatINR(row.costImpact) : 'None recorded'}
                  </p>
                  {detail.costNote && <p className="text-[11px] text-gray-500 max-w-[220px]">{detail.costNote}</p>}
                </div>
              </div>

              {row.escalated && (
                <p className="mt-2 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                  <b>Escalated.</b> It passed its response date without an answer, so it also appears on the Atm Head&rsquo;s list.
                </p>
              )}

              {canWrite && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {isLive(row.status) && (
                    <>
                      <button onClick={() => setPanel(panel === 'reassign' ? 'none' : 'reassign')} className="px-2.5 py-1.5 rounded border border-gray-300 bg-white text-gray-700 text-[12px] font-semibold min-h-[36px]">Reassign</button>
                      <button onClick={() => setPanel(panel === 'due' ? 'none' : 'due')} className="px-2.5 py-1.5 rounded border border-gray-300 bg-white text-gray-700 text-[12px] font-semibold min-h-[36px]">Revise response date</button>
                    </>
                  )}
                  <button onClick={() => setPanel(panel === 'cost' ? 'none' : 'cost')} className="px-2.5 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-900 text-[12px] font-semibold min-h-[36px]">
                    {row.costImpact ? 'Revise cost impact' : 'Record cost impact'}
                  </button>
                  {isLive(row.status) && (
                    detail.canClose
                      ? <button onClick={() => setPanel(panel === 'close' ? 'none' : 'close')} className="px-2.5 py-1.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 text-[12px] font-semibold min-h-[36px]">Close</button>
                      : <span className="px-2.5 py-1.5 text-[11px] text-gray-500 self-center">Closed by {row.raisedByName ?? 'the originator'} — reply to ask for closure</span>
                  )}
                  {!isLive(row.status) && (
                    <button onClick={() => setPanel(panel === 'reopen' ? 'none' : 'reopen')} className="px-2.5 py-1.5 rounded border border-gray-300 bg-white text-gray-700 text-[12px] font-semibold min-h-[36px]">Reopen</button>
                  )}
                  {row.costImpact != null && row.costImpact > 0 && (
                    <Link href={`/cost-control/working-sheets/new-quick?project=${row.projectId}`} className="px-2.5 py-1.5 rounded border border-indigo-300 bg-indigo-50 text-indigo-800 text-[12px] font-semibold min-h-[36px] inline-flex items-center">
                      Raise a working sheet
                    </Link>
                  )}
                </div>
              )}

              {panel === 'reassign' && (
                <Panelette title="Reassign this entry">
                  <form action={(fd: FormData) => start(async () => {
                    const to = String(fd.get('to') ?? '')
                    const note = String(fd.get('note') ?? '')
                    const isStake = to.startsWith('s:')
                    after(await reassignEntry(row.id,
                      isStake ? { stakeholderId: to.slice(2) } : { userId: to }, note))
                  })} className="space-y-2">
                    <select name="to" required className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px]">
                      <option value="">Choose a person or firm…</option>
                      <optgroup label="CT Hub users">
                        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </optgroup>
                      {stakeholders.length > 0 && (
                        <optgroup label="Project stakeholders">
                          {stakeholders.map(s => <option key={s.id} value={`s:${s.id}`}>{s.name}{s.discipline ? ` — ${s.discipline}` : ''}</option>)}
                        </optgroup>
                      )}
                    </select>
                    <input name="note" placeholder="Why it is going to them (optional)" className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                    <Submit pending={pending}>Reassign</Submit>
                  </form>
                </Panelette>
              )}

              {panel === 'due' && (
                <Panelette title="Revise the response date">
                  <form action={(fd: FormData) => start(async () =>
                    after(await reviseDueDate(row.id, String(fd.get('due') ?? ''), String(fd.get('reason') ?? ''))))} className="space-y-2">
                    <input type="date" name="due" required defaultValue={row.dueOn ?? ''} className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                    <input name="reason" required placeholder="Why the date is changing — this is recorded" className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                    <Submit pending={pending}>Save the new date</Submit>
                  </form>
                </Panelette>
              )}

              {panel === 'cost' && (
                <Panelette title="Cost impact">
                  <form action={(fd: FormData) => start(async () => {
                    const raw = String(fd.get('amount') ?? '').replace(/[^0-9.]/g, '')
                    after(await setCostImpact(row.id, raw ? Number(raw) : null, String(fd.get('note') ?? '')))
                  })} className="space-y-2">
                    <input name="amount" inputMode="decimal" defaultValue={row.costImpact ?? ''} placeholder="Amount in rupees — leave blank to clear" className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px] tabular-nums" />
                    <input name="note" defaultValue={detail.costNote ?? ''} placeholder="What the figure covers" className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                    <p className="text-[11px] text-gray-500">Recording a figure here does not move any budget. It marks the entry so the money is not forgotten when the working sheet is raised.</p>
                    <Submit pending={pending}>Save</Submit>
                  </form>
                </Panelette>
              )}

              {panel === 'close' && (
                <Panelette title="Close this entry">
                  <form action={(fd: FormData) => start(async () => after(await closeEntry(row.id, String(fd.get('note') ?? ''))))} className="space-y-2">
                    <input name="note" placeholder="What settled it (optional, but it is what people read later)" className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                    <Submit pending={pending}>Close</Submit>
                  </form>
                </Panelette>
              )}

              {panel === 'reopen' && (
                <Panelette title="Reopen this entry">
                  <form action={(fd: FormData) => start(async () => after(await reopenEntry(row.id, String(fd.get('reason') ?? ''))))} className="space-y-2">
                    <input name="reason" required placeholder="Why it is being reopened" className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                    <Submit pending={pending}>Reopen</Submit>
                  </form>
                </Panelette>
              )}
            </div>

            {/* ── What was said ────────────────────────────────────────── */}
            <div className="divide-y divide-gray-100">
              {detail.posts.map((p, i) => (
                <div key={p.id} className={`px-4 py-3 ${row.kind === 'instruction' && i === 0 ? 'bg-violet-50/60 border-l-2 border-l-violet-500' : ''}`}>
                  <div className="flex items-center gap-2">
                    <Who name={p.author} />
                    <div>
                      <p className="text-[13px] font-bold text-gray-900 leading-tight">{p.author}</p>
                      <p className="text-[11px] text-gray-500">
                        {formatDateTime(p.createdAt)}{p.editedAt ? ' · edited' : ''}
                      </p>
                    </div>
                    {i === 0 && <span className="ml-auto text-[11px] text-gray-400">opened it</span>}
                  </div>
                  <p className="text-[13px] text-gray-700 mt-2 whitespace-pre-wrap break-words leading-relaxed">{p.body}</p>
                  {p.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {p.attachments.map((a, j) => (
                        <span key={j} className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600">{a.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ── Reply ────────────────────────────────────────────────── */}
            {canWrite && (
              <div className="px-4 py-3 border-t border-gray-200">
                <MentionTextarea
                  value={reply}
                  onChange={(v, ids) => { setReply(v); setMentions(ids) }}
                  placeholder="Write a reply — type @ to bring someone in"
                  rows={3}
                  maxLength={8000}
                />
                <div className="flex items-center gap-2 mt-2">
                  {row.assignedToId === detail.myId && row.raisedById !== detail.myId && (
                    <p className="text-[11px] text-gray-500">Replying returns this to {row.raisedByName ?? 'the originator'} as <b>Responded</b>.</p>
                  )}
                  <button
                    disabled={pending || !reply.trim()}
                    onClick={() => start(async () => after(await replyToEntry(row.id, reply, mentions)))}
                    className="ml-auto px-3 py-2 rounded bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-50 min-h-[40px]"
                  >
                    {pending ? 'Sending…' : 'Send reply'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Who is kept informed ─────────────────────────────────── */}
            <div className="px-4 py-3 border-t border-gray-200">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                Kept informed ({detail.watchers.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {detail.watchers.length
                  ? detail.watchers.map(w => (
                      <span key={w.id} className="text-[11px] bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">{w.name}</span>
                    ))
                  : <span className="text-[12px] text-gray-400">Nobody beyond the two people above</span>}
              </div>
              {detail.myId && (
                <button
                  onClick={() => start(async () => {
                    const on = !detail.watchers.some(w => w.id === detail.myId)
                    after(await setWatching(row.id, on))
                  })}
                  className="mt-2 text-[12px] font-semibold text-indigo-700"
                >
                  {detail.watchers.some(w => w.id === detail.myId) ? 'Stop following this entry' : 'Follow this entry'}
                </button>
              )}
            </div>

            {/* ── The trail ────────────────────────────────────────────── */}
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Record of actions</p>
              <div className="text-[12px] text-gray-600 space-y-1">
                {detail.events.map(e => (
                  <p key={e.id}>
                    <span className="text-gray-400 tabular-nums">{formatDateTime(e.createdAt)}</span>
                    {' — '}<b>{EVENT_WORDS[e.event] ?? e.event}</b>
                    {' by '}{e.actor}
                    {e.detail ? ` — ${e.detail}` : ''}
                  </p>
                ))}
                <p className="text-gray-400 pt-1">Stamped as it happened. Nothing here can be edited or removed.</p>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  )
}

const EVENT_WORDS: Record<string, string> = {
  raised: 'Raised',
  responded: 'Responded',
  reassigned: 'Reassigned',
  due_date_revised: 'Response date revised',
  cost_impact_set: 'Cost impact recorded',
  closed: 'Closed',
  reopened: 'Reopened',
}

function Panelette({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-[12px] font-bold text-gray-900 mb-2">{title}</p>
      {children}
    </div>
  )
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={pending} className="px-3 py-2 rounded bg-gray-900 text-white text-[12px] font-semibold disabled:opacity-50 min-h-[40px]">
      {pending ? 'Saving…' : children}
    </button>
  )
}
