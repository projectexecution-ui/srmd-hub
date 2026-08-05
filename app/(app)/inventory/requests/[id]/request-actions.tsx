'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QtyInput } from '@/components/inventory/QtyInput'
import { Textarea } from '@/components/ui/textarea'
import { confirm } from '@/components/ui/confirm-dialog'
import { Loader2, Check, X, Truck, Undo2, PackageCheck, Ban } from 'lucide-react'
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
  requestId, status, role, lines, currentUserId, engineerId, isKeeper = false, alreadyAcknowledged,
}: {
  requestId: string
  status: string
  role: Role | null
  lines: Line[]
  currentUserId: string | null
  engineerId: string
  isKeeper?: boolean
  alreadyAcknowledged: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const supabase = createClient()

  const isAdmin       = role === 'admin'
  const isStore       = role === 'store_manager'
  // Atm Head = `head` canonically. Legacy `hop` still works for backward compat.
  const isAtmHead     = role === 'head' || role === 'hop'
  const isRequesting  = currentUserId != null && currentUserId === engineerId

  // Editable issued qtys + returnable flags
  const [issuedQty, setIssuedQty] = useState<Record<string, string>>(
    // Default to what's still to hand over (approved − already issued), so
    // partial issues in rounds are natural.
    Object.fromEntries(lines.map(l => [l.id, String(Math.max((l.approved_qty ?? 0) - l.issued_qty, 0))])),
  )
  const [returnable, setReturnable] = useState<Record<string, boolean>>(
    Object.fromEntries(lines.map(l => [l.id, !!l.is_returnable])),
  )
  const [remarks, setRemarks] = useState('')
  const [cancelReason, setCancelReason] = useState('')

  // Return form state
  const [returnLineId, setReturnLineId] = useState('')
  const [returnQty, setReturnQty] = useState('')
  const [returnCondition, setReturnCondition] = useState<'good' | 'damaged'>('good')
  const [returnRemarks, setReturnRemarks] = useState('')

  /**
   * Run an inventory RPC and react to the outcome.
   *
   * @param redirectTo  Where to go after a SUCCESSFUL action.
   *                    Set to '' (empty string) to stay on the
   *                    same page (e.g. when the user might want
   *                    to log another return).
   *                    Otherwise we router.push() the user to the
   *                    next logical screen so the chain feels
   *                    connected — backoffice approves → back to
   *                    their inbox to grab the next one, etc.
   */
  async function rpc(
    name: string,
    params: Record<string, unknown>,
    successMsg: string,
    redirectTo: string = '',
  ) {
    setBusy(true); setErr(null); setMsg(null)
    const { error } = await supabase.rpc(name, params)
    setBusy(false)
    if (error) { setErr(error.message); return false }
    setMsg(successMsg)
    if (redirectTo) {
      // Small delay so the success banner is visible before
      // the navigation kicks in — feels less abrupt.
      setTimeout(() => router.push(redirectTo), 700)
    } else {
      router.refresh()
    }
    return true
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
                <div key={l.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 md:items-center text-sm border-b border-gray-100 md:border-0 pb-2 md:pb-0 last:border-0">
                  <div className="md:col-span-8 min-w-0">
                    <div className="text-gray-800 truncate">{l.item_label}</div>
                    <div className="text-xs text-gray-500">approved {l.approved_qty ?? 0} {l.unit}</div>
                  </div>
                  <label className="md:col-span-4 inline-flex items-center gap-2 text-sm text-gray-700">
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
                return rpc('inv_rpc_hop_approve', { p_request_id: requestId, p_remarks: remarks.trim() || null, p_returnable_items: returnableItems }, 'Approved. Store can now issue.', '/inventory/inbox/hop')
              }} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button onClick={async () => {
                if (!remarks.trim()) { setErr('Reject reason is required'); return }
                await rpc('inv_rpc_hop_reject', { p_request_id: requestId, p_remarks: remarks.trim() }, 'Rejected. Reservations released.', '/inventory/inbox/hop')
              }} disabled={busy} variant="outline" className="text-rose-700 border-rose-200 hover:bg-rose-50">
                <X className="h-4 w-4" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    }

    return null
  }

  // ─── Store issue ──────────────────────────────────────────────
  function storePanel() {
    if (!isStore && !isAdmin && !isKeeper) return null
    if (status !== 'APPROVED' && status !== 'EMERGENCY_ISSUED') return null
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Store issue</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">Enter the qty being handed over now (cannot exceed approved). You can issue in parts — if you hand over less than approved, the request stays open for the rest.</p>
          <div className="space-y-1">
            {lines.map(l => {
              const remaining = Math.max((l.approved_qty ?? 0) - l.issued_qty, 0)
              return (
              <div key={l.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 md:items-center text-sm border-b border-gray-100 md:border-0 pb-2 md:pb-0 last:border-0">
                <div className="md:col-span-7 min-w-0">
                  <div className="text-gray-800 truncate">{l.item_label}</div>
                  <div className="text-xs text-gray-500">
                    approved {l.approved_qty ?? 0} {l.unit}
                    {l.issued_qty > 0 && <span> · already issued {l.issued_qty}</span>}
                    {remaining > 0 && <span className="text-blue-700"> · to hand over {remaining}</span>}
                    {l.is_returnable && <span className="ml-2 text-amber-700 font-semibold">· returnable</span>}
                  </div>
                </div>
                <div className="md:col-span-4 flex items-center gap-2">
                  <div className="flex-1"><QtyInput
                    value={issuedQty[l.id] ?? ''}
                    onChange={(v) => setIssuedQty(s => ({ ...s, [l.id]: v }))} /></div>
                  <span className="text-xs text-gray-500 md:hidden">{l.unit}</span>
                </div>
                <span className="hidden md:inline md:col-span-1 text-xs text-gray-500">{l.unit}</span>
              </div>
              )
            })}
          </div>
          <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional)" />
          <Button onClick={async () => {
            const items = lines.map(l => ({ request_item_id: l.id, issued_qty: Number(issuedQty[l.id]) }))
            if (items.some(i => !Number.isFinite(i.issued_qty) || i.issued_qty < 0)) { setErr('Enter a valid issued qty for every line'); return }
            await rpc('inv_rpc_store_issue', { p_request_id: requestId, p_issued_items: items, p_remarks: remarks.trim() || null }, 'Handed over. Any shortfall stays open for the rest.', '/inventory/inbox/store')
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
            returnables.length > 0 ? 'Receipt confirmed. Returnable items still tracked.' : 'Receipt confirmed. Request closed.',
            returnables.length > 0 ? '' : '/inventory/requests',
          )} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
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
              <QtyInput value={returnQty} onChange={setReturnQty} />
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

  // ─── Requester (or admin): cancel a mistaken request before it's issued ──
  function cancelPanel() {
    if (!isRequesting && !isAdmin) return null
    if (!['PENDING_HOP', 'APPROVED', 'EMERGENCY_ISSUED'].includes(status)) return null
    return (
      <Card className="border-gray-200">
        <CardHeader><CardTitle className="text-base">Cancel this request</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">Raised by mistake or no longer needed? Withdraw it before it&apos;s issued. This can&apos;t be undone.</p>
          <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} placeholder="Reason (optional)" />
          <Button
            onClick={async () => {
              if (!(await confirm({
                title: 'Cancel this request?',
                message: 'It will be withdrawn and can’t be un-cancelled.',
                confirmLabel: 'Cancel request',
                danger: true,
              }))) return
              await rpc('inv_rpc_cancel_request', { p_request_id: requestId, p_reason: cancelReason.trim() || null }, 'Request cancelled.', '/inventory/requests')
            }}
            disabled={busy}
            variant="outline"
            className="text-rose-700 border-rose-200 hover:bg-rose-50"
          >
            <Ban className="h-4 w-4" /> Cancel request
          </Button>
        </CardContent>
      </Card>
    )
  }

  const anyPanel = atmHeadPanel() || storePanel() || receiptPanel() || returnPanel() || cancelPanel()
  if (!anyPanel) return null

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}
      {busy && <p className="text-sm text-gray-500 inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Working…</p>}
      {atmHeadPanel()}
      {storePanel()}
      {receiptPanel()}
      {returnPanel()}
      {cancelPanel()}
    </div>
  )
}
