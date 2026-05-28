'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Check, X, AlertTriangle, Truck, Undo2, PackageCheck } from 'lucide-react'
import type { Role } from '@/lib/types'

interface Line {
  id: string
  item_id: string
  item_label: string
  unit: string
  requested_qty: number
  approved_qty: number | null
  issued_qty: number
  available_qty: number
  returned_good_qty: number
  returned_damaged_qty: number
  is_returnable: boolean
}

export function RequestActions({
  requestId, status, role, lines, currentUserId, engineerId, alreadyAcknowledged,
}: {
  requestId: string
  status: string
  role: Role | null
  lines: Line[]
  currentUserId: string | null
  engineerId: string
  alreadyAcknowledged: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const supabase = createClient()

  const isAdmin       = role === 'admin'
  const isBackoffice  = role === 'backoffice' || role === 'backoffice_backup'
  const isStore       = role === 'store_manager'
  // Atm Head = `head` canonically. Legacy `hop` still works for backward compat.
  const isAtmHead     = role === 'head' || role === 'hop'
  const isRequesting  = currentUserId != null && currentUserId === engineerId

  // Either Backoffice or Storekeeper can do the availability check.
  const canDoCheck    = isBackoffice || isStore || isAdmin

  // Editable approved/issued qtys + returnable flags
  const [approvedQty, setApprovedQty] = useState<Record<string, string>>(
    Object.fromEntries(lines.map(l => [l.id, String(l.approved_qty ?? l.requested_qty)])),
  )
  const [issuedQty, setIssuedQty] = useState<Record<string, string>>(
    Object.fromEntries(lines.map(l => [l.id, String(l.approved_qty ?? 0)])),
  )
  const [returnable, setReturnable] = useState<Record<string, boolean>>(
    Object.fromEntries(lines.map(l => [l.id, !!l.is_returnable])),
  )
  const [remarks, setRemarks] = useState('')

  // Return form state
  const [returnLineId, setReturnLineId] = useState('')
  const [returnQty, setReturnQty] = useState('')
  const [returnCondition, setReturnCondition] = useState<'good' | 'damaged'>('good')
  const [returnRemarks, setReturnRemarks] = useState('')

  async function rpc(name: string, params: Record<string, unknown>, successMsg: string) {
    setBusy(true); setErr(null); setMsg(null)
    const { error } = await supabase.rpc(name, params)
    setBusy(false)
    if (error) { setErr(error.message); return false }
    setMsg(successMsg)
    router.refresh()
    return true
  }

  // ─── Availability check (Backoffice OR Storekeeper) ────────────
  function checkPanel() {
    if (status !== 'PENDING_BACKOFFICE') return null
    if (!canDoCheck) return null
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Availability check</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">
            Confirm whether the requested items are available — either backoffice or storekeeper can do this step.
            Edit qty per line if you can only partially fulfil, then mark available.
          </p>
          <div className="space-y-1">
            {lines.map(l => (
              <div key={l.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                <div className="col-span-7 truncate">
                  <span className="text-gray-800">{l.item_label}</span>
                  <span className="text-xs text-gray-500 ml-2">req {l.requested_qty} {l.unit} · avail {l.available_qty} {l.unit}</span>
                </div>
                <div className="col-span-4">
                  <Input type="number" step="any" inputMode="decimal"
                    value={approvedQty[l.id] ?? ''}
                    onChange={e => setApprovedQty(s => ({ ...s, [l.id]: e.target.value }))} />
                </div>
                <span className="col-span-1 text-xs text-gray-500">{l.unit}</span>
              </div>
            ))}
          </div>
          <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional for available, required for not-available)" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={async () => {
              const items = lines.map(l => ({ request_item_id: l.id, approved_qty: Number(approvedQty[l.id]) }))
              if (items.some(i => !Number.isFinite(i.approved_qty) || i.approved_qty < 0)) { setErr('Enter a valid qty for every line'); return }
              await rpc('inv_rpc_backoffice_approve', { p_request_id: requestId, p_approved_items: items, p_remarks: remarks.trim() || null }, 'Marked available. Stock reserved. Sent to Atm Head.')
            }} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
              <Check className="h-4 w-4" /> Mark available & send to Atm Head
            </Button>
            <Button onClick={async () => {
              if (!remarks.trim()) { setErr('Reason required when marking not-available'); return }
              await rpc('inv_rpc_backoffice_reject', { p_request_id: requestId, p_remarks: remarks.trim() }, 'Not available — engineer notified.')
            }} disabled={busy} variant="outline" className="text-rose-700 border-rose-200 hover:bg-rose-50">
              <X className="h-4 w-4" /> Not available
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ─── Atm Head approval (with per-line returnable flag) ─────────
  function atmHeadPanel() {
    if (!isAtmHead && !isAdmin) return null

    if (status === 'PENDING_HOP') {
      const tickedCount = lines.reduce((n, l) => n + (returnable[l.id] ? 1 : 0), 0)
      const allTicked = tickedCount === lines.length && lines.length > 0
      const tickAll  = () => setReturnable(Object.fromEntries(lines.map(l => [l.id, true])))
      const clearAll = () => setReturnable(Object.fromEntries(lines.map(l => [l.id, false])))
      return (
        <Card>
          <CardHeader><CardTitle className="text-base">Atm Head approval</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">
              Tick <b>Returnable</b> for items the engineer must return when the project ends (e.g. tools, formwork).
              Items left unticked are consumable and don&apos;t need to come back.
            </p>
            {/* Select-all / clear toggles — essential when a request has many lines */}
            <div className="flex items-center justify-between gap-2 px-1 py-1.5 border-y border-gray-100 bg-gray-50/50 rounded">
              <span className="text-xs text-gray-600">
                <b>{tickedCount}</b> of <b>{lines.length}</b> ticked returnable
              </span>
              <div className="flex gap-1.5">
                <button type="button" onClick={tickAll}
                  className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center gap-1">
                  <Check className="h-3 w-3" /> {allTicked ? 'All ticked' : 'Select all'}
                </button>
                <button type="button" onClick={clearAll}
                  className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center gap-1">
                  <X className="h-3 w-3" /> Clear all
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {lines.map(l => (
                <div key={l.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                  <div className="col-span-8 truncate">
                    <span className="text-gray-800">{l.item_label}</span>
                    <span className="text-xs text-gray-500 ml-2">approved {l.approved_qty ?? 0} {l.unit}</span>
                  </div>
                  <label className="col-span-4 inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={returnable[l.id] ?? false}
                      onChange={e => setReturnable(s => ({ ...s, [l.id]: e.target.checked }))}
                    />
                    Returnable
                  </label>
                </div>
              ))}
            </div>
            <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional for approve, required for reject)" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => {
                const returnableItems = lines.map(l => ({ request_item_id: l.id, is_returnable: !!returnable[l.id] }))
                return rpc('inv_rpc_hop_approve', { p_request_id: requestId, p_remarks: remarks.trim() || null, p_returnable_items: returnableItems }, 'Approved. Store can now issue.')
              }} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button onClick={async () => {
                if (!remarks.trim()) { setErr('Reject reason is required'); return }
                await rpc('inv_rpc_hop_reject', { p_request_id: requestId, p_remarks: remarks.trim() }, 'Rejected. Reservations released.')
              }} disabled={busy} variant="outline" className="text-rose-700 border-rose-200 hover:bg-rose-50">
                <X className="h-4 w-4" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    }

    if (status === 'PENDING_BACKOFFICE' && isAtmHead) {
      return (
        <Card className="border-rose-200 bg-rose-50/40">
          <CardHeader><CardTitle className="text-base text-rose-800 inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Atm Head emergency bypass</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-rose-700">Skips the availability check. Reserves stock at requested qty and routes straight to Store. Logged in the audit trail.</p>
            <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Reason for bypass (required)" />
            <Button onClick={async () => {
              if (!remarks.trim()) { setErr('Bypass reason is required'); return }
              await rpc('inv_rpc_hop_emergency_authorize', { p_request_id: requestId, p_remarks: remarks.trim() }, 'Emergency authorised. Store can issue.')
            }} disabled={busy} className="bg-rose-600 hover:bg-rose-700">
              <AlertTriangle className="h-4 w-4" /> Authorise emergency
            </Button>
          </CardContent>
        </Card>
      )
    }
    return null
  }

  // ─── Store issue ──────────────────────────────────────────────
  function storePanel() {
    if (!isStore && !isAdmin) return null
    if (status !== 'APPROVED' && status !== 'EMERGENCY_ISSUED') return null
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Store issue</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">Enter the actual qty being handed over (cannot exceed approved). Issuing deducts stock and releases the reservation.</p>
          <div className="space-y-1">
            {lines.map(l => (
              <div key={l.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                <div className="col-span-7 truncate">
                  <span className="text-gray-800">{l.item_label}</span>
                  <span className="text-xs text-gray-500 ml-2">approved {l.approved_qty ?? 0} {l.unit}{l.is_returnable && <span className="ml-2 text-amber-700 font-semibold">· returnable</span>}</span>
                </div>
                <div className="col-span-4">
                  <Input type="number" step="any" inputMode="decimal"
                    value={issuedQty[l.id] ?? ''}
                    onChange={e => setIssuedQty(s => ({ ...s, [l.id]: e.target.value }))} />
                </div>
                <span className="col-span-1 text-xs text-gray-500">{l.unit}</span>
              </div>
            ))}
          </div>
          <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional)" />
          <Button onClick={async () => {
            const items = lines.map(l => ({ request_item_id: l.id, issued_qty: Number(issuedQty[l.id]) }))
            if (items.some(i => !Number.isFinite(i.issued_qty) || i.issued_qty < 0)) { setErr('Enter a valid issued qty for every line'); return }
            await rpc('inv_rpc_store_issue', { p_request_id: requestId, p_issued_items: items, p_remarks: remarks.trim() || null }, 'Issued. Engineer will be asked to confirm receipt.')
          }} disabled={busy} className="bg-blue-600 hover:bg-blue-700">
            <Truck className="h-4 w-4" /> Issue
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ─── Engineer receipt acknowledgement ─────────────────────────
  function receiptPanel() {
    if (status !== 'ISSUED' && status !== 'EMERGENCY_ISSUED') return null
    if (alreadyAcknowledged) return null
    if (!isRequesting && !isAdmin) return null
    const returnables = lines.filter(l => l.is_returnable)
    return (
      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardHeader><CardTitle className="text-base inline-flex items-center gap-1.5"><PackageCheck className="h-4 w-4 text-emerald-700" /> Confirm receipt</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-700">
            Confirm that you received the items issued against this request. Once confirmed, the request closes
            {returnables.length > 0 ? <> — but <b>{returnables.length}</b> line{returnables.length === 1 ? '' : 's'} flagged as returnable stays open until you log the return at project end.</> : '.'}
          </p>
          {returnables.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <b>To return at project end:</b>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {returnables.map(l => <li key={l.id}>{l.item_label} ({l.issued_qty} {l.unit})</li>)}
              </ul>
            </div>
          )}
          <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Notes (optional)" />
          <Button onClick={() => rpc('inv_rpc_engineer_acknowledge', { p_request_id: requestId, p_notes: remarks.trim() || null },
            returnables.length > 0 ? 'Receipt confirmed. Returnable items still tracked.' : 'Receipt confirmed. Request closed.')
          } disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
            <PackageCheck className="h-4 w-4" /> Confirm receipt
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ─── Returns ──────────────────────────────────────────────────
  function returnPanel() {
    if (status !== 'ISSUED' && status !== 'CLOSED' && status !== 'EMERGENCY_ISSUED') return null
    // Only items flagged as returnable AND with outstanding qty
    const returnable = lines.filter(l => l.is_returnable && (l.issued_qty - l.returned_good_qty - l.returned_damaged_qty) > 0)
    if (returnable.length === 0) return null
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Log a return</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">Returnable items flagged at Atm Head approval can be returned here.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Item</p>
              <select value={returnLineId} onChange={e => setReturnLineId(e.target.value)}
                className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
                <option value="">— Select line —</option>
                {returnable.map(l => {
                  const outstanding = l.issued_qty - l.returned_good_qty - l.returned_damaged_qty
                  return <option key={l.id} value={l.id}>{l.item_label} (outstanding {outstanding} {l.unit})</option>
                })}
              </select>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Qty</p>
              <Input type="number" step="any" inputMode="decimal" value={returnQty} onChange={e => setReturnQty(e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Condition</p>
              <select value={returnCondition} onChange={e => setReturnCondition(e.target.value as 'good' | 'damaged')}
                className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
                <option value="good">Good (back to usable)</option>
                <option value="damaged">Damaged (flagged)</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Remarks</p>
              <Input value={returnRemarks} onChange={e => setReturnRemarks(e.target.value)} />
            </div>
          </div>
          <Button onClick={async () => {
            const q = Number(returnQty)
            if (!returnLineId) { setErr('Pick a line'); return }
            if (!Number.isFinite(q) || q <= 0) { setErr('Enter a positive return qty'); return }
            await rpc('inv_rpc_return_material', {
              p_request_item_id: returnLineId,
              p_qty: q,
              p_condition: returnCondition,
              p_remarks: returnRemarks.trim() || null,
            }, 'Return logged.')
            setReturnQty(''); setReturnRemarks(''); setReturnLineId('')
          }} disabled={busy} variant="outline">
            <Undo2 className="h-4 w-4" /> Log return
          </Button>
        </CardContent>
      </Card>
    )
  }

  const anyPanel = checkPanel() || atmHeadPanel() || storePanel() || receiptPanel() || returnPanel()
  if (!anyPanel) return null

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}
      {busy && <p className="text-sm text-gray-500 inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Working…</p>}
      {checkPanel()}
      {atmHeadPanel()}
      {storePanel()}
      {receiptPanel()}
      {returnPanel()}
    </div>
  )
}
