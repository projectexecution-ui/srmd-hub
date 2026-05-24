'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Check, X, AlertTriangle, Truck, Undo2 } from 'lucide-react'
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
}

export function RequestActions({ requestId, status, role, lines }: {
  requestId: string
  status: string
  role: Role | null
  lines: Line[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const supabase = createClient()

  const isAdmin = role === 'admin'
  const isBackoffice = role === 'backoffice' || role === 'backoffice_backup'
  const isHop = role === 'hop'
  const isStore = role === 'store_manager'

  // Editable approved/issued/return qtys
  const [approvedQty, setApprovedQty] = useState<Record<string, string>>(
    Object.fromEntries(lines.map(l => [l.id, String(l.approved_qty ?? l.requested_qty)])),
  )
  const [issuedQty, setIssuedQty] = useState<Record<string, string>>(
    Object.fromEntries(lines.map(l => [l.id, String(l.approved_qty ?? 0)])),
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

  // ---------- Backoffice / Admin: approve / reject when PENDING_BACKOFFICE ----------
  function backofficePanel() {
    if (status !== 'PENDING_BACKOFFICE') return null
    if (!isBackoffice && !isAdmin) return null
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Backoffice action</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">Edit approved qty per line, then approve to reserve stock — or reject with reason.</p>
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
          <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional for approve, required for reject)" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={async () => {
              const items = lines.map(l => ({ request_item_id: l.id, approved_qty: Number(approvedQty[l.id]) }))
              if (items.some(i => !Number.isFinite(i.approved_qty) || i.approved_qty < 0)) { setErr('Enter a valid approved qty for every line'); return }
              await rpc('inv_rpc_backoffice_approve', { p_request_id: requestId, p_approved_items: items, p_remarks: remarks.trim() || null }, 'Approved. Stock reserved.')
            }} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
              <Check className="h-4 w-4" /> Approve & reserve
            </Button>
            <Button onClick={async () => {
              if (!remarks.trim()) { setErr('Reject reason is required'); return }
              await rpc('inv_rpc_backoffice_reject', { p_request_id: requestId, p_remarks: remarks.trim() }, 'Rejected.')
            }} disabled={busy} variant="outline" className="text-rose-700 border-rose-200 hover:bg-rose-50">
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ---------- HoP: approve / reject when PENDING_HOP + emergency on PENDING_BACKOFFICE ----------
  function hopPanel() {
    if (!isHop && !isAdmin) return null

    if (status === 'PENDING_HOP') {
      return (
        <Card>
          <CardHeader><CardTitle className="text-base">HoP action</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional for approve, required for reject)" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => rpc('inv_rpc_hop_approve', { p_request_id: requestId, p_remarks: remarks.trim() || null }, 'Approved. Ready for store to issue.')} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
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

    if (status === 'PENDING_BACKOFFICE' && isHop) {
      return (
        <Card className="border-rose-200 bg-rose-50/40">
          <CardHeader><CardTitle className="text-base text-rose-800 inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> HoP emergency bypass</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-rose-700">Skips Backoffice. Reserves stock at requested qty and routes straight to Store to issue. Logged in the audit trail.</p>
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

  // ---------- Store: issue when APPROVED or EMERGENCY_ISSUED ----------
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
                  <span className="text-xs text-gray-500 ml-2">approved {l.approved_qty ?? 0} {l.unit}</span>
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
            await rpc('inv_rpc_store_issue', { p_request_id: requestId, p_issued_items: items, p_remarks: remarks.trim() || null }, 'Issued. Stock deducted.')
          }} disabled={busy} className="bg-blue-600 hover:bg-blue-700">
            <Truck className="h-4 w-4" /> Issue
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ---------- Returns when something has been issued ----------
  function returnPanel() {
    if (status !== 'ISSUED' && status !== 'CLOSED' && status !== 'EMERGENCY_ISSUED') return null
    // Only show if there's outstanding qty to return
    const returnable = lines.filter(l => (l.issued_qty - l.returned_good_qty - l.returned_damaged_qty) > 0)
    if (returnable.length === 0) return null
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Log a return</CardTitle></CardHeader>
        <CardContent className="space-y-3">
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

  const anyPanel = backofficePanel() || hopPanel() || storePanel() || returnPanel()
  if (!anyPanel) return null

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}
      {busy && <p className="text-sm text-gray-500 inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Working…</p>}
      {backofficePanel()}
      {hopPanel()}
      {storePanel()}
      {returnPanel()}
    </div>
  )
}
