'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Plus, Trash2, Loader2, Lock, AlertTriangle } from 'lucide-react'
import { findDuplicateMatches, type PastItem, type DupMatch } from '@/lib/dup-detect'
import { formatINR } from '@/lib/utils'
import { wsStatusLabel, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  upsertWorkingSheetItem,
  deleteWorkingSheetItem,
  type WSApprovalContext,
} from '@/components/cost-control/ws-actions'
import { WSApprovalActions, type SignOffCfg } from '@/components/cost-control/WSApprovalActions'

interface Vendor { id: string; name: string }

export interface WSItem {
  id: string
  sr_no: number
  description: string
  uom: string
  qty: number
  rate: number
  gst_pct: number
  total_amount: number | null
  vendor_id: string | null
  location_tag: string | null
  remark: string | null
}

interface Props {
  wsId: string
  status: WSStatus
  canEdit: boolean
  ctx: WSApprovalContext
  vendors: Vendor[]
  initialItems: WSItem[]
  pastItems?: PastItem[]
  wsTotal: number
  approvedSoFar?: number
  signOffCfg?: SignOffCfg
}

const UOM_OPTIONS = ['Sft', 'Sqm', 'Rm', 'Mt', 'Cum', 'Nos', 'MT', 'Kg', 'Ltr', 'Ls']
const GST_OPTIONS = [0, 5, 12, 18, 28]

export function WSEditor({ wsId, status, canEdit, ctx, vendors, initialItems, pastItems = [], wsTotal, approvedSoFar = 0, signOffCfg }: Props) {
  const router = useRouter()
  const [items, setItems] = React.useState<WSItem[]>(initialItems)
  const [error, setError] = React.useState<string | null>(null)
  const [savingItemId, setSavingItemId] = React.useState<string | null>(null)

  const locked = status !== 'draft' && status !== 'returned'
  const editable = canEdit && !locked

  const total = items.reduce((s, i) => s + Number(i.total_amount ?? (i.qty * i.rate * (1 + i.gst_pct / 100))), 0)
  // Keep header total in sync with our local sum when items change locally
  const displayTotal = total || wsTotal

  function nextSrNo() {
    return items.length === 0 ? 1 : Math.max(...items.map(i => i.sr_no)) + 1
  }

  async function addRow() {
    if (!editable) return
    const tmpId = 'new-' + Date.now()
    const draft: WSItem = {
      id: tmpId,
      sr_no: nextSrNo(),
      description: '',
      uom: 'Sft',
      qty: 1,
      rate: 0,
      gst_pct: 18,
      total_amount: 0,
      vendor_id: null,
      location_tag: null,
      remark: null,
    }
    setItems(prev => [...prev, draft])
  }

  /** Save a single row to the server. */
  async function persistRow(idx: number) {
    const row = items[idx]
    if (!row || !editable) return
    if (!row.description || row.description.trim().length < 2) {
      setError(`Row ${row.sr_no}: description is required`)
      return
    }
    setSavingItemId(row.id)
    setError(null)
    const isNew = row.id.startsWith('new-')
    const res = await upsertWorkingSheetItem({
      id: isNew ? undefined : row.id,
      working_sheet_id: wsId,
      sr_no: row.sr_no,
      description: row.description.trim(),
      uom: row.uom,
      qty: Number(row.qty) || 0,
      rate: Number(row.rate) || 0,
      gst_pct: Number(row.gst_pct) || 0,
      vendor_id: row.vendor_id,
      location_tag: row.location_tag,
      remark: row.remark,
    })
    setSavingItemId(null)
    if (!res.ok) { setError(res.error ?? 'Save failed'); return }
    if (isNew && res.id) {
      setItems(prev => prev.map((r, i) => (i === idx ? { ...r, id: res.id!, total_amount: r.qty * r.rate * (1 + r.gst_pct / 100) } : r)))
    } else {
      setItems(prev => prev.map((r, i) => (i === idx ? { ...r, total_amount: r.qty * r.rate * (1 + r.gst_pct / 100) } : r)))
    }
    // Quietly refresh server-rendered totals
    router.refresh()
  }

  async function removeRow(idx: number) {
    const row = items[idx]
    if (!row || !editable) return
    if (row.id.startsWith('new-')) {
      setItems(prev => prev.filter((_, i) => i !== idx))
      return
    }
    const ok = await confirm({
      title: 'Delete this row?',
      message: row.description.trim()
        ? `"${row.description.trim()}" will be removed from this sheet.`
        : `Row ${row.sr_no} will be removed from this sheet.`,
      danger: true,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    setSavingItemId(row.id); setError(null)
    const res = await deleteWorkingSheetItem(row.id, wsId)
    setSavingItemId(null)
    if (!res.ok) { setError(res.error ?? 'Delete failed'); return }
    setItems(prev => prev.filter((_, i) => i !== idx))
    router.refresh()
  }

  function updateField<K extends keyof WSItem>(idx: number, key: K, value: WSItem[K]) {
    setItems(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, [key]: value }
      // Recompute total locally for instant feedback
      next.total_amount = Number(next.qty) * Number(next.rate) * (1 + Number(next.gst_pct) / 100)
      return next
    }))
  }

  // Save any dirty (never-blurred) rows before the shared block submits.
  async function flushNewRows() {
    for (let i = 0; i < items.length; i++) {
      const r = items[i]
      if (r.id.startsWith('new-')) await persistRow(i)
    }
  }

  return (
    <Card className="p-0 overflow-hidden">
      {locked && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-50 border-b border-amber-200 text-amber-900">
          <Lock className="h-4 w-4" />
          <span>Sheet is locked — status is <b>{wsStatusLabel(status)}</b>. Items can no longer be edited.</span>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 text-sm bg-red-50 border-b border-red-200 text-red-800">{error}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-2 py-2 text-left w-10">Sr</th>
              <th className="px-2 py-2 text-left" title="What is the work or material?">What is the work?</th>
              <th className="px-2 py-2 text-left w-24" title="Unit of measure — Sft, Nos, Kg…">Unit</th>
              <th className="px-2 py-2 text-right w-20" title="How many units?">How many</th>
              <th className="px-2 py-2 text-right w-28" title="Price per unit, in rupees">Rate (₹)</th>
              <th className="px-2 py-2 text-right w-16">GST %</th>
              <th className="px-2 py-2 text-right w-32" title="Auto-calculated: how many × rate + GST">Amount (₹)</th>
              <th className="px-2 py-2 text-left w-40">Vendor</th>
              <th className="px-2 py-2 text-left w-32">Location</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-500">No items yet. {editable ? 'Click "Add row" below to begin.' : ''}</td></tr>
            )}
            {items.map((row, idx) => {
              const saving = savingItemId === row.id
              return (
                <tr key={row.id} className={`border-t border-gray-100 ${saving ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-2 py-2 text-gray-500 tabular-nums">{row.sr_no}</td>
                  <td className="px-2 py-2">
                    <Input
                      value={row.description}
                      onChange={e => updateField(idx, 'description', e.target.value)}
                      onBlur={() => persistRow(idx)}
                      disabled={!editable}
                      placeholder="e.g. Internal painting on walls"
                      className="h-9"
                    />
                    <DuplicateHint
                      description={row.description}
                      pastItems={pastItems}
                      rowId={row.id}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={row.uom}
                      onChange={e => { updateField(idx, 'uom', e.target.value); }}
                      onBlur={() => persistRow(idx)}
                      disabled={!editable}
                      className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                    >
                      {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <MoneyInput
                      value={row.qty}
                      onChange={(v) => updateField(idx, 'qty', v === '' ? 0 : Number(v))}
                      onBlur={() => persistRow(idx)}
                      disabled={!editable}
                      className="h-9 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <MoneyInput
                      value={row.rate}
                      onChange={(v) => updateField(idx, 'rate', v === '' ? 0 : Number(v))}
                      onBlur={() => persistRow(idx)}
                      disabled={!editable}
                      className="h-9 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={row.gst_pct}
                      onChange={e => { updateField(idx, 'gst_pct', Number(e.target.value)); }}
                      onBlur={() => persistRow(idx)}
                      disabled={!editable}
                      className="h-9 w-full rounded-md border border-gray-300 bg-white px-1 text-sm text-right"
                    >
                      {GST_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-right font-semibold text-gray-900 tabular-nums">
                    {formatINR(row.total_amount ?? row.qty * row.rate * (1 + row.gst_pct / 100))}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={row.vendor_id ?? ''}
                      onChange={e => updateField(idx, 'vendor_id', e.target.value || null)}
                      onBlur={() => persistRow(idx)}
                      disabled={!editable}
                      className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                    >
                      <option value="">— vendor —</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      value={row.location_tag ?? ''}
                      onChange={e => updateField(idx, 'location_tag', e.target.value)}
                      onBlur={() => persistRow(idx)}
                      disabled={!editable}
                      placeholder="optional"
                      className="h-9"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600 inline" />
                    ) : editable ? (
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        title="Remove row"
                        className="text-red-600 hover:bg-red-50 rounded p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50">
              <td colSpan={6} className="px-2 py-2 text-right text-sm text-gray-600">This sheet adds up to</td>
              <td className="px-2 py-2 text-right font-bold text-lg text-gray-900 tabular-nums">{formatINR(displayTotal)}</td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add row + shared 3-stage approval block */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white space-y-3">
        {editable && (
          <Button type="button" onClick={addRow} size="sm" variant="outline">
            <Plus className="h-3.5 w-3.5" /> Add row
          </Button>
        )}
        <WSApprovalActions
            signOffCfg={signOffCfg}
          wsId={wsId}
          status={status}
          ctx={ctx}
          totalAmount={displayTotal}
          approvedSoFar={approvedSoFar}
          submitDisabled={items.length === 0 || displayTotal <= 0}
          onBeforeSubmit={flushNewRows}
        />
      </div>
    </Card>
  )
}

// DuplicateHint — Layer 1 of the 3-layer dup detection (lexical Jaccard).
function DuplicateHint({
  description,
  pastItems,
  rowId,
}: {
  description: string
  pastItems: PastItem[]
  rowId: string
}) {
  const matches = React.useMemo<DupMatch[]>(() => {
    if (!description || description.length < 4 || pastItems.length === 0) return []
    return findDuplicateMatches(description, pastItems)
  }, [description, pastItems])
  const [expanded, setExpanded] = React.useState(false)
  if (matches.length === 0) return null
  const top = matches[0]
  const bgClass =
    top.level === 'high'
      ? 'bg-red-50 border-red-200 text-red-800'
      : 'bg-amber-50 border-amber-200 text-amber-800'
  return (
    <div className={`mt-1 text-[11px] rounded-md border px-2 py-1 ${bgClass}`}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 w-full text-left"
        aria-controls={`dup-${rowId}`}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span className="truncate flex-1">
          {top.level === 'high' ? 'Possible duplicate' : 'Similar past item'} —{' '}
          <b>{Math.round(top.score * 100)}%</b> match{' '}
          <span className="text-gray-600">&quot;{top.item.description}&quot;</span>
        </span>
        <span className="text-gray-500 ml-2">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div id={`dup-${rowId}`} className="mt-1 space-y-0.5 pl-4 border-l border-current/20">
          {matches.map(m => (
            <div key={m.item.id} className="flex gap-2 text-gray-700">
              <span className="font-mono text-[10px] text-gray-500 shrink-0">
                {Math.round(m.score * 100)}%
              </span>
              <span className="truncate flex-1">{m.item.description}</span>
              <span className="text-gray-500 shrink-0 font-mono text-[10px]">{m.item.ws_code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
