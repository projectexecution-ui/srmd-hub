import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RequestStatusPill } from '@/components/inventory/RequestStatusPill'
import { formatDate } from '@/lib/utils'
import { RequestActions } from './request-actions'
import { RefreshCw } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function RequestDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermission('inventory', 'view')
  const [profile, user] = await Promise.all([getMyProfile(), getMyUser()])
  const role = profile?.role ?? null
  const supabase = await createClient()

  const { data: req } = await supabase
    .from('inv_requests')
    .select(`
      *,
      projects(code, name),
      inv_warehouses(code, name),
      inv_request_items(*, inv_items(code, name, unit, image_url)),
      inv_request_status_log(*)
    `)
    .eq('id', id)
    .single()

  if (!req) notFound()

  // Compute available qty per item for this warehouse (used in approval UI)
  const itemIds = (req.inv_request_items ?? []).map((ri: { item_id: string }) => ri.item_id)
  const { data: stock } = itemIds.length > 0
    ? await supabase.from('inv_stock_available').select('item_id, available_qty').eq('warehouse_id', req.warehouse_id).in('item_id', itemIds)
    : { data: [] }
  const availByItem = new Map<string, number>(
    (stock ?? []).map(s => [s.item_id, Number(s.available_qty)]),
  )

  const proj = Array.isArray(req.projects) ? req.projects[0] : req.projects
  const wh   = Array.isArray(req.inv_warehouses) ? req.inv_warehouses[0] : req.inv_warehouses

  type Line = {
    id: string
    item_id: string
    requested_qty: number
    approved_qty: number | null
    issued_qty: number
    returned_good_qty: number
    returned_damaged_qty: number
    is_returnable: boolean
    remarks: string | null
    inv_items: { code: string; name: string; unit: string; image_url: string | null } | Array<{ code: string; name: string; unit: string; image_url: string | null }> | null
  }
  const lines: Line[] = (req.inv_request_items ?? []) as Line[]

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title={req.request_no} back="/inventory/requests">
        <RequestStatusPill status={req.status} />
      </PageHeader>

      {/* Re-raise banner: shown when the request was rejected and the
          current user owns it (or is admin). One click opens the
          /requests/new form with every line + project + warehouse +
          urgency pre-filled from this rejected request. */}
      {(req.status === 'REJECTED_BACKOFFICE' || req.status === 'REJECTED_HOP') &&
        (user?.id === req.engineer_id || role === 'admin') && (
        <Card className="bg-orange-50 border-orange-200 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-orange-900">
            This request was rejected. Open a fresh request with the same items pre-filled, edit what changed, and resubmit.
          </div>
          <Link
            href={`/inventory/requests/new?from=${req.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium bg-orange-700 text-white px-3 py-1.5 rounded-lg hover:bg-orange-800 whitespace-nowrap"
          >
            <RefreshCw className="h-4 w-4" /> Re-raise this request
          </Link>
        </Card>
      )}

      {/* Meta card */}
      <Card>
        <CardContent className="pt-5 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Meta label="Project"   value={proj ? `${proj.code} — ${proj.name}` : '—'} />
          <Meta label="Warehouse" value={wh ? `${wh.code} — ${wh.name}` : '—'} />
          <Meta label="Urgency"   value={req.urgency} />
          <Meta label="Required by" value={req.required_by_date ? formatDate(req.required_by_date) : '—'} />
          {req.purpose && <div className="col-span-2 md:col-span-4">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Purpose</p>
            <p className="text-gray-800 whitespace-pre-line">{req.purpose}</p>
          </div>}
        </CardContent>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Item</th>
                  <th className="px-2 py-2 text-right">Requested</th>
                  <th className="px-2 py-2 text-right">Approved</th>
                  <th className="px-2 py-2 text-right">Issued</th>
                  <th className="px-2 py-2 text-right">Available</th>
                  <th className="px-2 py-2 text-center">Returnable</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const it = Array.isArray(l.inv_items) ? l.inv_items[0] : l.inv_items
                  const avail = availByItem.get(l.item_id) ?? 0
                  return (
                    <tr key={l.id} className="border-t border-gray-100">
                      <td className="px-2 py-2">
                        <span className="font-mono text-[11px] font-bold text-blue-700">{it?.code}</span>
                        <span className="ml-2 font-medium text-gray-900">{it?.name}</span>
                        {l.remarks && <p className="text-xs text-gray-500">{l.remarks}</p>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{Number(l.requested_qty).toLocaleString('en-IN')} {it?.unit}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.approved_qty != null ? Number(l.approved_qty).toLocaleString('en-IN') : '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{Number(l.issued_qty).toLocaleString('en-IN')}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-500">{Number(avail).toLocaleString('en-IN')}</td>
                      <td className="px-2 py-2 text-center">
                        {l.is_returnable
                          ? <span className="inline-flex items-center text-amber-700 text-xs font-semibold">●</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Role-based action buttons */}
      <RequestActions
        requestId={req.id}
        status={req.status}
        role={role}
        currentUserId={user?.id ?? null}
        engineerId={req.engineer_id}
        alreadyAcknowledged={!!req.engineer_acknowledged_at}
        lines={lines.map(l => {
          const it = Array.isArray(l.inv_items) ? l.inv_items[0] : l.inv_items
          return {
            id: l.id,
            item_id: l.item_id,
            item_label: `${it?.code ?? ''} — ${it?.name ?? ''}`,
            unit: it?.unit ?? '',
            requested_qty: Number(l.requested_qty),
            approved_qty: l.approved_qty == null ? null : Number(l.approved_qty),
            issued_qty: Number(l.issued_qty),
            available_qty: availByItem.get(l.item_id) ?? 0,
            returned_good_qty: Number(l.returned_good_qty),
            returned_damaged_qty: Number(l.returned_damaged_qty),
            is_returnable: !!l.is_returnable,
          }
        })}
      />

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {(req.inv_request_status_log ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 italic">No events yet.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {(req.inv_request_status_log ?? [])
                .slice()
                .sort((a: { action_at: string }, b: { action_at: string }) => new Date(a.action_at).getTime() - new Date(b.action_at).getTime())
                .map((e: { id: string; from_status: string | null; to_status: string; action_at: string; remarks: string | null }) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className="text-gray-400 text-xs mt-0.5 w-28 flex-shrink-0">{formatDate(e.action_at)}</span>
                  <div className="min-w-0">
                    <p className="text-gray-800">
                      {e.from_status ? <span className="text-gray-500">{e.from_status} →</span> : null} <b>{e.to_status}</b>
                    </p>
                    {e.remarks && <p className="text-xs text-gray-600 mt-0.5">{e.remarks}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-gray-800 font-medium capitalize">{value}</p>
    </div>
  )
}
