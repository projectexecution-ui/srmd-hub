'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Loader2, Check, AlertTriangle, X, Camera, FileImage, MessageSquare,
} from 'lucide-react'
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
  photo_url: string | null
  has_photo: boolean
}

export function EntriesPendingApproval({ initial }: { initial: PendingEntry[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Per-row remarks textarea state. Keyed by entry id; presence in the
  // map = "note panel is open". Value = current textarea content.
  const [noteOpen, setNoteOpen] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // ── Group rows by project (e.g. NGH-A, LEA, SBT) so PMs can review
  // one site at a time. Order: project label alphabetical.
  const groups = useMemo(() => {
    const m = new Map<string, PendingEntry[]>()
    for (const r of rows) {
      const arr = m.get(r.project_label) ?? []
      arr.push(r)
      m.set(r.project_label, arr)
    }
    return Array.from(m.entries())
      .map(([label, items]) => ({
        label,
        items,
        total: items.reduce((s, r) => s + r.amount, 0),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  const allChecked = useMemo(
    () => rows.length > 0 && selected.size === rows.length,
    [rows.length, selected.size],
  )
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
  function toggleGroup(groupItems: PendingEntry[]) {
    const ids = groupItems.map(r => r.id)
    setSelected(prev => {
      const allInGroup = ids.every(id => prev.has(id))
      const next = new Set(prev)
      if (allInGroup) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }
  function openNote(id: string, initialValue = '') {
    setNoteOpen(prev => ({ ...prev, [id]: initialValue }))
  }
  function setNote(id: string, value: string) {
    setNoteOpen(prev => ({ ...prev, [id]: value }))
  }
  function closeNote(id: string) {
    setNoteOpen(prev => {
      const next = { ...prev }; delete next[id]; return next
    })
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
    setRows(prev => prev.filter(r => !ids.includes(r.id)))
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
    // Close any open note panels for these rows.
    setNoteOpen(prev => {
      const next = { ...prev }
      for (const id of ids) delete next[id]
      return next
    })
    startTransition(() => router.refresh())
    return true
  }

  async function approveRow(id: string) {
    const note = noteOpen[id]?.trim()
    await call('approve', [id], note || undefined)
  }
  async function flagRow(id: string) {
    const note = noteOpen[id]?.trim()
    if (!note) {
      // Force the note panel open if not already, so the PM can type a reason.
      openNote(id, noteOpen[id] ?? '')
      setErr('Remarks required when flagging — add a note.')
      return
    }
    await call('flag', [id], note)
  }
  async function approveSelected() {
    if (selected.size > 0) await call('approve', Array.from(selected))
  }

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

      {/* Project groups */}
      <div className="divide-y divide-gray-100">
        {groups.map(g => {
          const groupSelected = g.items.filter(r => selected.has(r.id)).length
          const allInGroup = groupSelected === g.items.length
          return (
            <div key={g.label}>
              {/* Group header */}
              <div className="px-4 py-2 bg-gray-50/80 border-y border-gray-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.items)}
                    className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                    title={allInGroup ? `Clear ${g.label} selection` : `Select all in ${g.label}`}
                  >
                    {allInGroup ? `Clear ${g.label}` : `Select ${g.label}`}
                  </button>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="font-semibold text-gray-800 truncate">{g.label}</span>
                </div>
                <p className="text-xs text-gray-500 flex-shrink-0">
                  {g.items.length} {g.items.length === 1 ? 'entry' : 'entries'} · {formatINR(g.total)}
                  {groupSelected > 0 && groupSelected < g.items.length && (
                    <span className="ml-2 text-blue-700">{groupSelected} ticked</span>
                  )}
                </p>
              </div>

              {/* Rows in this group */}
              <ul className="divide-y divide-gray-100">
                {g.items.map(r => {
                  const isOpen = r.id in noteOpen
                  const noteVal = noteOpen[r.id] ?? ''
                  return (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                          className="h-4 w-4 mt-1"
                          aria-label={`Select entry ${r.id}`}
                        />
                        {/* Log sheet photo */}
                        {r.photo_url ? (
                          <a
                            href={r.photo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-shrink-0 h-14 w-14 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden hover:ring-2 hover:ring-blue-300 transition-shadow"
                            title="Open log sheet photo in a new tab"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={r.photo_url}
                              alt={`Log sheet — ${r.item_name} · ${r.entry_date}`}
                              width={56}
                              height={56}
                              loading="lazy"
                              className="h-14 w-14 object-cover"
                            />
                          </a>
                        ) : (
                          <div
                            className="flex-shrink-0 h-14 w-14 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-400"
                            title={r.has_photo ? 'Photo on file but URL could not be signed' : 'No photo — imported entry'}
                          >
                            {r.has_photo ? <Camera className="h-5 w-5" /> : <FileImage className="h-5 w-5" />}
                            <span className="text-[8px] uppercase tracking-wide mt-0.5">
                              {r.has_photo ? '!' : 'import'}
                            </span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900">{r.item_name}</span>
                            <span className="text-xs text-gray-500">{formatDateIN(r.entry_date)}</span>
                            {!r.has_photo && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 uppercase tracking-wide">
                                imported · no photo
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {r.contractor_name} · <span className="text-gray-500">by {r.engineer_name}</span>
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
                              onClick={() => approveRow(r.id)}
                              disabled={busy}
                              className="bg-emerald-600 hover:bg-emerald-700 h-7 px-2"
                              title={isOpen && noteVal.trim() ? 'Approve with note' : 'Approve'}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => flagRow(r.id)}
                              disabled={busy}
                              className="text-rose-700 border-rose-200 hover:bg-rose-50 h-7 px-2"
                              title="Flag — note required"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => (isOpen ? closeNote(r.id) : openNote(r.id))}
                              className={`h-7 px-2 gap-1 ${
                                isOpen || noteVal.trim()
                                  ? 'text-blue-700 bg-blue-50'
                                  : 'text-gray-500'
                              }`}
                              title={isOpen ? 'Hide note' : 'Add a comment (optional on approve, required on flag)'}
                              aria-label={isOpen ? 'Hide note' : 'Add a comment'}
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              <span className="text-xs">{noteVal.trim() ? 'Note ✓' : 'Note'}</span>
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Inline note panel */}
                      {isOpen && (
                        <div className="mt-2 ml-7 flex items-start gap-2">
                          <Textarea
                            autoFocus
                            value={noteVal}
                            onChange={e => setNote(r.id, e.target.value)}
                            placeholder="Optional note on approve — required on flag (e.g. hours look high, check meter reading)"
                            rows={2}
                            className="text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => closeNote(r.id)}
                            className="h-8 px-2 flex-shrink-0"
                            title="Close note"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
