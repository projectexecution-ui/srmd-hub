'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Check, AlertTriangle, X } from 'lucide-react'
import { formatINR, formatDateIN } from '@/lib/jmr/format'

export interface PendingEntry {
  id: string
  entry_date: string
  quantity: number
  amount: number
  rate_snapshot: number
  unit: string
  item_name: string
  project_label: string
  contractor_name: string
  engineer_name: string
}

export function EntriesPendingApproval({ initial }: { initial: PendingEntry[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flagFor, setFlagFor] = useState<string | null>(null)
  const [flagRemarks, setFlagRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const allChecked = useMemo(() => rows.length > 0 && selected.size === rows.length, [rows.length, selected.size])
  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(rows.map(r => r.id)))
  }

  async function call(action: 'approve' | 'flag', ids: string[], remarks?: string) {
    setBusy(true); setErr(null)
    const res = await fetch('/api/jmr/entries/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action, remarks }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErr(body.error ?? `Request failed (${res.status})`)
      return false
    }
    // Optimistic: drop the affected rows from the list.
    setRows(prev => prev.filter(r => !ids.includes(r.id)))
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
    startTransition(() => router.refresh())
    return true
  }

  async function approveOne(id: string)   { await call('approve', [id]) }
  async function flagSubmit(id: string)   {
    if (!flagRemarks.trim()) { setErr('Remarks required when flagging'); return }
    const ok = await call('flag', [id], flagRemarks.trim())
    if (ok) { setFlagFor(null); setFlagRemarks('') }
  }
  async function approveSelected()        { if (selected.size > 0) await call('approve', Array.from(selected)) }

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-gray-500">
        No JMR entries waiting for approval.
      </Card>
    )
  }

  return (
    <Card>
      {/* Header bar with bulk action */}
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            className="h-4 w-4"
            aria-label="Select all"
          />
          <p className="text-sm font-bold text-gray-800">
            {rows.length} entries pending · {formatINR(total)}
          </p>
        </div>
        <Button
          size="sm"
          onClick={approveSelected}
          disabled={selected.size === 0 || busy}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Approve {selected.size > 0 ? `${selected.size} selected` : ''}
        </Button>
      </div>

      {err && (
        <p className="px-4 py-2 text-xs text-rose-700 bg-rose-50 border-b border-rose-200">
          {err}
        </p>
      )}

      {/* Rows */}
      <ul className="divide-y divide-gray-100">
        {rows.map(r => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
                className="h-4 w-4 mt-1"
                aria-label={`Select entry ${r.id}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{r.item_name}</span>
                  <span className="text-xs text-gray-500">{formatDateIN(r.entry_date)}</span>
                </div>
                <p className="text-xs text-gray-600 mt-0.5">
                  {r.project_label} · {r.contractor_name} · <span className="text-gray-500">by {r.engineer_name}</span>
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  <span className="font-mono">{r.quantity}</span> {r.unit}
                  <span className="text-gray-400"> @ {formatINR(r.rate_snapshot)}</span>
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-semibold text-emerald-700">{formatINR(r.amount)}</p>
                <div className="mt-1 flex items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => approveOne(r.id)}
                    disabled={busy}
                    className="bg-emerald-600 hover:bg-emerald-700 h-7 px-2"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setFlagFor(r.id); setFlagRemarks(''); setErr(null) }}
                    disabled={busy}
                    className="text-rose-700 border-rose-200 hover:bg-rose-50 h-7 px-2"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Inline flag remarks input */}
            {flagFor === r.id && (
              <div className="mt-2 ml-7 flex items-center gap-2">
                <Input
                  autoFocus
                  value={flagRemarks}
                  onChange={e => setFlagRemarks(e.target.value)}
                  placeholder="Why is this flagged?"
                  className="h-8 text-xs"
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); flagSubmit(r.id) }
                    if (e.key === 'Escape') { setFlagFor(null); setFlagRemarks('') }
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => flagSubmit(r.id)}
                  disabled={busy || !flagRemarks.trim()}
                  className="bg-rose-600 hover:bg-rose-700 h-8 px-2"
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> Flag
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setFlagFor(null); setFlagRemarks('') }}
                  className="h-8 px-2"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
