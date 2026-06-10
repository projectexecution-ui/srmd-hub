'use client'
// Bulk-approve UI for thumbrule sheets. Single table, checkboxes,
// shared comment, one button. Results panel after submit shows
// per-row outcome (✓ approved / ✗ blocked) so the user knows which
// rows still need attention.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Check, Loader2, X, AlertTriangle, ExternalLink } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { confirm } from '@/components/ui/confirm-dialog'
import { bulkApproveThumbrule, type BulkApprovalResult } from './actions'

export interface BulkItem {
  id: string
  ws_code: string
  status: 'submitted' | 'partially_approved'
  total_amount: number
  built_up_sft: number | null
  rate_per_sft: number | null
  summary_notes: string | null
  submitted_at: string | null
  engineer_name: string
  project_code: string
  project_name: string
  discipline_label: string
  sub_skill_label: string
}

export function BulkApproveClient({ items }: { items: BulkItem[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [comment, setComment]   = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [results, setResults]   = useState<BulkApprovalResult[] | null>(null)
  const [pending, startTransition] = useTransition()

  const allSelected = items.length > 0 && selected.size === items.length
  const someSelected = selected.size > 0 && selected.size < items.length
  const selectedTotal = items
    .filter(i => selected.has(i.id))
    .reduce((s, i) => s + i.total_amount, 0)

  function toggle(id: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(items.map(i => i.id)))
  }

  async function onApprove() {
    if (selected.size === 0) return
    setError(null)
    const ok = await confirm({
      title: `Approve ${selected.size} thumbrule sheet${selected.size === 1 ? '' : 's'}?`,
      message: `Total amount being released into ERP: ${formatINR(selectedTotal)}.\n\n` +
        `Each sheet still passes through the normal approval matrix — any blocked by role/cap rules will be reported back.`,
      confirmLabel: `Approve ${selected.size}`,
      danger: false,
    })
    if (!ok) return
    startTransition(async () => {
      const res = await bulkApproveThumbrule({
        ws_ids: Array.from(selected),
        comment: comment.trim() || null,
      })
      if (!res.ok) { setError(res.error); return }
      setResults(res.results)
      // Drop only the IDs that succeeded — failed ones stay ticked so the
      // user can retry after fixing whatever the matrix complained about.
      setSelected(prev => {
        const n = new Set(prev)
        for (const r of res.results) if (r.ok) n.delete(r.ws_id)
        return n
      })
      router.refresh()
    })
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleAll}
                  className="rounded border-gray-300"
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 font-semibold">WS Code</th>
              <th className="px-3 py-2 font-semibold">Project</th>
              <th className="px-3 py-2 font-semibold">Discipline · Sub-skill</th>
              <th className="px-3 py-2 font-semibold">Engineer</th>
              <th className="px-3 py-2 font-semibold text-right">Built-up</th>
              <th className="px-3 py-2 font-semibold text-right">₹/sft</th>
              <th className="px-3 py-2 font-semibold text-right">Total</th>
              <th className="px-3 py-2 font-semibold">Submitted</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => {
              const failed = results?.find(r => r.ws_id === i.id && !r.ok)
              const approved = results?.find(r => r.ws_id === i.id && r.ok)
              return (
                <tr
                  key={i.id}
                  className={`border-t border-gray-100 ${
                    approved ? 'bg-emerald-50/40' : failed ? 'bg-rose-50/40' : 'hover:bg-gray-50/60'
                  }`}
                >
                  <td className="px-3 py-2.5">
                    {approved ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={selected.has(i.id)}
                        onChange={() => toggle(i.id)}
                        className="rounded border-gray-300"
                        aria-label={`Select ${i.ws_code}`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/cost-control/working-sheets/${i.id}`} target="_blank" className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-1">
                      {i.ws_code}
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </Link>
                    {failed && (
                      <p className="text-[10px] text-rose-700 inline-flex items-center gap-0.5 mt-0.5">
                        <AlertTriangle className="h-2.5 w-2.5" /> {failed.error}
                      </p>
                    )}
                    {approved && (
                      <p className="text-[10px] text-emerald-700 mt-0.5">Approved {approved.error ? `(${approved.error})` : ''}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-gray-900">{i.project_code}</p>
                    <p className="text-[10px] text-gray-500 truncate max-w-[180px]" title={i.project_name}>{i.project_name}</p>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 truncate max-w-[220px]">{i.discipline_label} → {i.sub_skill_label}</td>
                  <td className="px-3 py-2.5 text-gray-700 truncate max-w-[140px]">{i.engineer_name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                    {i.built_up_sft != null ? `${i.built_up_sft.toLocaleString('en-IN')} sft` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-900 font-semibold">
                    {i.rate_per_sft != null ? formatINR(i.rate_per_sft) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">{formatINR(i.total_amount)}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">
                    {i.submitted_at ? formatDate(i.submitted_at) : '—'}
                  </td>
                  <td className="px-3 py-2.5"></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-200 bg-gray-50 p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-700">
            <b>{selected.size}</b> selected ·{' '}
            <span className="tabular-nums font-semibold text-gray-900">{formatINR(selectedTotal)}</span> total release into ERP
          </p>
          {results && (
            <p className="text-xs text-gray-600">
              Last run: <span className="text-emerald-700 font-semibold">{results.filter(r => r.ok).length} approved</span>
              {results.some(r => !r.ok) && (
                <span className="text-rose-700 font-semibold ml-2">· {results.filter(r => !r.ok).length} blocked</span>
              )}
            </p>
          )}
        </div>

        <div>
          <label className="text-[11px] font-semibold text-gray-700">Shared comment (logged against every approval)</label>
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={2}
            placeholder="e.g. Reviewed rates against last quarter benchmarks. Approving as released into ERP."
            disabled={pending}
            className="mt-1"
          />
        </div>

        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={pending || selected.size === 0} onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          <Button variant="success" size="sm" disabled={pending || selected.size === 0} onClick={onApprove}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve {selected.size > 0 ? selected.size : ''} selected
          </Button>
        </div>
      </div>
    </Card>
  )
}
