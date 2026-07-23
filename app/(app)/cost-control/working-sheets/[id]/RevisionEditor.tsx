'use client'
// In-app revision editor (cc_cumulative_versions). A revision (v2+) is raised
// with NO Excel re-upload: the prior approved rows are shown LOCKED (read from
// the frozen earlier version — they can never be edited here), and the engineer
// enters ONLY the delta — changed quantities/rates and brand-new items. Every
// changed or new row must point at a working file (uploaded in "Working &
// evidence" above) before the sheet can be submitted.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, Lock, AlertTriangle, Loader2, Save, Send, Paperclip } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { normalizeKey } from '@/lib/cost-control/version-ledger'
import { evaluateItem } from '@/lib/cost-control/boq-template-parse'
import { BOQ_UNITS } from '@/lib/cost-control/boq-template'
import { saveRevisionRows, type RevisionRowInput } from './version-actions'
import { submitWorkingSheet } from '@/components/cost-control/ws-actions'
import { addWsComment } from '@/components/cost-control/comment-actions'

export interface PriorApprovedRow {
  description: string
  unit: string | null
  qty: number
  rate: number
  amount: number
}
export interface RevisionAttachment { id: string; name: string }
export interface DeltaRow {
  key: string
  description: string
  unit: string
  qty: number | null
  material: number | null
  installation: number | null
  ml: number | null
  workingRefId: string | null
  cellNote: string
}

interface Props {
  wsId: string
  priorApproved: PriorApprovedRow[]
  initial: DeltaRow[]
  attachments: RevisionAttachment[]
  canEdit: boolean
}

const numOrNull = (v: string): number | null => {
  if (v.trim() === '') return null
  const n = Number(v.replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
const EPS = 0.5

export function RevisionEditor({ wsId, priorApproved, initial, attachments, canEdit }: Props) {
  const router = useRouter()
  const [rows, setRows] = React.useState<DeltaRow[]>(initial)
  const [busy, setBusy] = React.useState<null | 'save' | 'submit'>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  // ONE working file backs the whole revision (engineers upload a single
  // working / Measurement sheet) — far cleaner than a dropdown on every row.
  // Seeded from any per-row link that came in, else the first attachment.
  const [defaultWorkingId, setDefaultWorkingId] = React.useState<string | null>(
    initial.find(r => r.workingRefId)?.workingRefId ?? attachments[0]?.id ?? null,
  )
  // Mandatory note the approver reads — required to submit (not to save draft).
  const [submitComment, setSubmitComment] = React.useState('')

  const priorMap = React.useMemo(() => {
    const m = new Map<string, PriorApprovedRow>()
    for (const p of priorApproved) m.set(normalizeKey(p.description), p)
    return m
  }, [priorApproved])

  // A row needs a working link when it's NEW (no prior match) or CHANGED
  // (qty or recomputed rate differs from what was approved).
  function rowNeedsLink(r: DeltaRow): boolean {
    const ev = evaluateItem(r)
    const prior = priorMap.get(normalizeKey(r.description))
    if (!prior) return true // new
    if (Math.abs((r.qty ?? 0) - prior.qty) > 1e-6) return true
    if (Math.abs(ev.rate - prior.rate) > EPS) return true
    return false
  }

  function update(idx: number, patch: Partial<DeltaRow>) {
    setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function remove(idx: number) { setRows(rows.filter((_, i) => i !== idx)) }
  function addRow() {
    setRows([...rows, {
      key: 'new-' + rows.length + '-' + rows.reduce((s, r) => s + (r.qty ?? 0), 0),
      description: '', unit: 'Cum', qty: null, material: null, installation: null, ml: null,
      workingRefId: attachments[0]?.id ?? null, cellNote: '',
    }])
  }

  const evals = rows.map(evaluateItem)
  const deltaTotal = evals.reduce((s, e) => s + e.amount, 0)
  const hardErrors = rows.reduce((n, r, i) => {
    const e = evals[i]
    // Every changed/new row must be backed by the one revision working file.
    return n + e.errors.length + (rowNeedsLink(r) && !defaultWorkingId ? 1 : 0)
  }, 0)
  const unlinked = defaultWorkingId ? 0 : rows.filter(rowNeedsLink).length

  function toPayload(): RevisionRowInput[] {
    return rows.map(r => ({
      description: r.description.trim(),
      unit: r.unit || null,
      qty: r.qty,
      material: r.material,
      installation: r.installation,
      ml: r.ml,
      // Changed/new rows are all backed by the single revision working file.
      working_ref: rowNeedsLink(r) && defaultWorkingId
        ? { attachment_id: defaultWorkingId, cell_note: r.cellNote.trim() || null }
        : null,
    }))
  }

  async function save(): Promise<boolean> {
    if (rows.some(r => !r.description.trim())) { setError('Every row needs a description'); return false }
    setBusy('save'); setError(null); setMsg(null)
    const res = await saveRevisionRows(wsId, toPayload())
    setBusy(null)
    if (!res.ok) { setError(res.error); return false }
    setMsg(`Saved — this revision asks ${formatINR(res.total)}`)
    router.refresh()
    return true
  }

  async function submit() {
    if (rows.filter(r => r.description.trim()).length === 0) { setError('Add at least one item'); return }
    if (hardErrors > 0) { setError(`Fix ${hardErrors} problem${hardErrors > 1 ? 's' : ''} first — including linking every changed/new row to a working file`); return }
    // Comment is mandatory when sending for approval (every stage requires one).
    if (submitComment.trim().length < 3) { setError('Add a short note for the approver (what changed in this revision) before sending.'); return }
    setBusy('submit'); setError(null); setMsg(null)
    const saved = await saveRevisionRows(wsId, toPayload())
    if (!saved.ok) { setBusy(null); setError(saved.error); return }
    const c = await addWsComment(wsId, submitComment.trim())
    if (!c.ok) { setBusy(null); setError(c.error ?? 'Could not save your note'); return }
    const sub = await submitWorkingSheet(wsId)
    setBusy(null)
    if (!sub.ok) { setError(sub.error ?? 'Submit failed'); return }
    setSubmitComment('')
    router.refresh()
  }

  const cellCls = 'h-8 text-right tabular-nums px-1'

  return (
    <div className="space-y-4">
      {/* Locked prior-approved rows */}
      {priorApproved.length > 0 && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 border-b border-gray-200 text-xs font-semibold text-gray-600">
            <Lock className="h-3.5 w-3.5" /> Already approved earlier — locked (carried forward, cannot be edited)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-1.5 text-left">Description</th>
                  <th className="px-2 py-1.5 text-left w-16">Unit</th>
                  <th className="px-2 py-1.5 text-right w-20">Qty</th>
                  <th className="px-2 py-1.5 text-right w-24">Rate</th>
                  <th className="px-2 py-1.5 text-right w-28">Amount</th>
                </tr>
              </thead>
              <tbody className="text-gray-500">
                {priorApproved.map((p, i) => (
                  <tr key={i} className="border-t border-gray-100 bg-gray-50/40">
                    <td className="px-2 py-1.5">{p.description}</td>
                    <td className="px-2 py-1.5">{p.unit ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{p.qty}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatINR(p.rate)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatINR(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Editable delta grid */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-emerald-50 border-b border-emerald-200">
          <span className="text-sm font-semibold text-emerald-900">This revision — changed &amp; new items only</span>
          <div className="flex items-center gap-3">
            {/* ONE working file for the whole revision — set here, not per row. */}
            {attachments.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-900">
                <Paperclip className="h-3.5 w-3.5" />
                Working:
                {attachments.length === 1 ? (
                  <span className="font-medium max-w-[200px] truncate" title={attachments[0].name}>{attachments[0].name}</span>
                ) : (
                  <select value={defaultWorkingId ?? ''} onChange={e => setDefaultWorkingId(e.target.value || null)} disabled={!canEdit}
                    className={`h-7 rounded-md border px-1.5 text-xs max-w-[200px] ${defaultWorkingId ? 'border-emerald-300 bg-white' : 'border-rose-300 bg-rose-50'}`}>
                    <option value="">— pick a working file —</option>
                    {attachments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </span>
            )}
            <span className={`text-xs font-medium ${hardErrors ? 'text-rose-700' : 'text-emerald-700'}`}>
              {hardErrors ? `${hardErrors} to fix` : 'Ready'}
            </span>
          </div>
        </div>

        {error && <p className="px-3 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-200">{error}</p>}
        {msg && <p className="px-3 py-2 text-xs text-emerald-700 bg-emerald-50 border-b border-emerald-100">{msg}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
              <tr>
                <th className="px-2 py-1.5 text-left min-w-[160px]">Description</th>
                <th className="px-2 py-1.5 text-left w-16">Unit</th>
                <th className="px-2 py-1.5 text-right w-20">Qty</th>
                <th className="px-2 py-1.5 text-right w-24">Material</th>
                <th className="px-2 py-1.5 text-right w-24">Install.</th>
                <th className="px-2 py-1.5 text-right w-24">M+L</th>
                <th className="px-2 py-1.5 text-right w-24">Amount</th>
                <th className="px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
                  No changes yet. Click &quot;Add item&quot; for a new line or a changed quantity.
                </td></tr>
              )}
              {rows.map((r, idx) => {
                const ev = evals[idx]
                const prior = priorMap.get(normalizeKey(r.description))
                return (
                  <React.Fragment key={r.key}>
                    <tr className={`border-t border-gray-100 ${ev.errors.length ? 'bg-rose-50/40' : ''}`}>
                      <td className="px-2 py-1.5">
                        <Input value={r.description} onChange={e => update(idx, { description: e.target.value })}
                          className="h-8" placeholder="e.g. Extra RCC (dwg R2)" disabled={!canEdit} />
                        {prior && (
                          <span className="text-[10px] text-amber-700">
                            was {prior.qty} @ {formatINR(prior.rate)} — revising
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={r.unit} onChange={e => update(idx, { unit: e.target.value })}
                          className="h-8 w-full rounded-md border border-gray-300 bg-white px-1 text-sm" disabled={!canEdit}>
                          {!BOQ_UNITS.includes(r.unit as typeof BOQ_UNITS[number]) && r.unit && <option value={r.unit}>{r.unit}</option>}
                          {BOQ_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5"><Input value={r.qty ?? ''} onChange={e => update(idx, { qty: numOrNull(e.target.value) })} className={cellCls} inputMode="decimal" disabled={!canEdit} /></td>
                      <td className="px-2 py-1.5"><Input value={r.material ?? ''} onChange={e => update(idx, { material: numOrNull(e.target.value) })} className={cellCls} inputMode="decimal" disabled={!canEdit} /></td>
                      <td className="px-2 py-1.5"><Input value={r.installation ?? ''} onChange={e => update(idx, { installation: numOrNull(e.target.value) })} className={cellCls} inputMode="decimal" disabled={!canEdit} /></td>
                      <td className="px-2 py-1.5"><Input value={r.ml ?? ''} onChange={e => update(idx, { ml: numOrNull(e.target.value) })} className={cellCls} inputMode="decimal" disabled={!canEdit} /></td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-900">{formatINR(ev.amount)}</td>
                      <td className="px-2 py-1.5 text-center">
                        {canEdit && (
                          <button type="button" onClick={() => remove(idx)} className="text-rose-600 hover:bg-rose-50 rounded p-1"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </td>
                    </tr>
                    {ev.errors.length > 0 && (
                      <tr className="bg-rose-50/40"><td></td><td colSpan={7} className="px-2 pb-1.5">
                        {ev.errors.map((e, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[11px] text-rose-700 mr-3"><AlertTriangle className="h-3 w-3" /> {e}</span>
                        ))}
                      </td></tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={6} className="px-2 py-2 text-right font-semibold text-gray-700">This version total (full BOQ)</td>
                <td className="px-2 py-2 text-right font-bold text-lg tabular-nums text-gray-900">{formatINR(deltaTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {canEdit && (
          <div className="px-3 py-3 border-t border-gray-100 space-y-2">
            {attachments.length === 0 && (
              <p className="inline-flex items-center gap-1.5 text-xs text-amber-700">
                <Paperclip className="h-3.5 w-3.5" /> Upload a working file in &quot;Working &amp; evidence&quot; above — it backs this revision&apos;s changed rows.
              </p>
            )}
            {unlinked > 0 && attachments.length > 0 && (
              <p className="inline-flex items-center gap-1.5 text-xs text-rose-700">
                <AlertTriangle className="h-3.5 w-3.5" /> Pick the working file for this revision (top of the grid) — it backs all {unlinked} changed/new row{unlinked > 1 ? 's' : ''}.
              </p>
            )}
            <div>
              <label className="text-xs font-semibold text-gray-700">Note for the approver <span className="text-rose-600">*</span></label>
              <textarea
                value={submitComment}
                onChange={e => setSubmitComment(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white p-2 text-sm"
                placeholder="Required to submit — what changed in this revision and why (the approver reads this)."
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add item
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={save} disabled={busy !== null}>
                {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />} Save draft
              </Button>
              <Button type="button" size="sm" onClick={submit} disabled={busy !== null || hardErrors > 0}>
                {busy === 'submit' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />} Submit for approval
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
