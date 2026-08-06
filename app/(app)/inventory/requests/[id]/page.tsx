import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { RequestStatusPill } from '@/components/inventory/RequestStatusPill'
import { formatDate, formatDateTime } from '@/lib/utils'
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

  const { data: req, error: reqErr } = await supabase
    .from('inv_requests')
    .select(`
      *,
      projects(code, name),
      inv_warehouses(code, name, store_manager_id),
      inv_request_items(*, inv_items(code, name, unit, image_url)),
      inv_request_status_log(*),
      inv_gate_passes(id, path, created_at)
    `)
    .eq('id', id)
    .single()

  if (reqErr) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
        <PageHeader title="Request" back="/inventory/requests" />
        <QueryError what="this request" message={reqErr.message} />
      </div>
    )
  }
  if (!req) notFound()

  // Compute available qty per item for this warehouse (used in approval UI)
  const itemIds = (req.inv_request_items ?? []).map((ri: { item_id: string }) => ri.item_id)
  const { data: stock, error: stockErr } = itemIds.length > 0
    ? await supabase.from('inv_stock_available').select('item_id, available_qty').eq('warehouse_id', req.warehouse_id).in('item_id', itemIds)
    : { data: [], error: null }
  const availByItem = new Map<string, number>(
    (stock ?? []).map(s => [s.item_id, Number(s.available_qty)]),
  )

  // Names for the history timeline (who did each step).
  const logActorIds = Array.from(new Set(
    ((req.inv_request_status_log ?? []) as Array<{ actor_id: string | null }>)
      .map(l => l.actor_id).filter(Boolean),
  )) as string[]
  const { data: actorRows, error: actorErr } = logActorIds.length > 0
    ? await supabase.from('profiles').select('id, full_name, name').in('id', logActorIds)
    : { data: [], error: null }
  const auxErr = stockErr ?? actorErr
  const actorName = new Map<string, string>(
    (actorRows ?? []).map(a => [a.id as string, (a.full_name ?? a.name ?? 'Someone') as string]),
  )

  const proj = Array.isArray(req.projects) ? req.projects[0] : req.projects
  const wh   = Array.isArray(req.inv_warehouses) ? req.inv_warehouses[0] : req.inv_warehouses
  // Is the current user the keeper of this request's store? Then they can issue,
  // whatever their base role.
  const isKeeper = !!(user?.id && (wh as { store_manager_id?: string | null } | null)?.store_manager_id === user.id)

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

  // Signed gate-pass copies — proof the engineer received the material.
  const gatePasses = (req.inv_gate_passes ?? []) as Array<{ id: string; path: string; created_at: string }>
  let gpDocs: Array<{ id: string; url: string; created_at: string; isPdf: boolean }> = []
  if (gatePasses.length > 0) {
    const { data: signed } = await supabase.storage.from('inv-gate-passes').createSignedUrls(gatePasses.map(g => g.path), 3600)
    const urlByPath = new Map<string, string>()
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
    gpDocs = gatePasses
      .map(g => ({ id: g.id, url: urlByPath.get(g.path) ?? '', created_at: g.created_at, isPdf: g.path.toLowerCase().endsWith('.pdf') }))
      .filter(d => d.url)
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title={req.request_no} back="/inventory/requests">
        <RequestStatusPill status={req.status} />
      </PageHeader>

      {auxErr && <QueryError what="availability & history details" message={auxErr.message} />}

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
          {/* Mobile: one card per line */}
          <div className="space-y-2 md:hidden">
            {lines.map(l => {
              const it = Array.isArray(l.inv_items) ? l.inv_items[0] : l.inv_items
              const avail = availByItem.get(l.item_id) ?? 0
              const ret = Number(l.returned_good_qty) + Number(l.returned_damaged_qty)
              return (
                <div key={l.id} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] font-bold text-blue-700">{it?.code}</span>
                      <p className="text-sm font-medium leading-tight text-gray-900">{it?.name}</p>
                      {l.remarks && <p className="mt-0.5 text-xs text-gray-500">{l.remarks}</p>}
                    </div>
                    {l.is_returnable && <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Returnable</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t border-gray-100 pt-2">
                    <LineStat label="Requested" value={`${Number(l.requested_qty).toLocaleString('en-IN')} ${it?.unit ?? ''}`} />
                    <LineStat label="Approved" value={l.approved_qty != null ? Number(l.approved_qty).toLocaleString('en-IN') : '—'} />
                    <LineStat label="Issued" value={Number(l.issued_qty).toLocaleString('en-IN')} />
                    <LineStat label="Returned" value={ret > 0 ? `${ret.toLocaleString('en-IN')}${Number(l.returned_damaged_qty) > 0 ? ` (${Number(l.returned_damaged_qty).toLocaleString('en-IN')} dmg)` : ''}` : '—'} />
                    <LineStat label="Available" value={stockErr ? '—' : Number(avail).toLocaleString('en-IN')} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop: full table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[640px] text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap">
                  <th className="px-2 py-2">Item</th>
                  <th className="px-2 py-2 text-right">Requested</th>
                  <th className="px-2 py-2 text-right">Approved</th>
                  <th className="px-2 py-2 text-right">Issued</th>
                  <th className="px-2 py-2 text-right">Returned</th>
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
                      <td className="px-2 py-2 text-right tabular-nums">
                        {(() => {
                          const ret = Number(l.returned_good_qty) + Number(l.returned_damaged_qty)
                          return ret > 0
                            ? <span className="text-amber-700">{ret.toLocaleString('en-IN')}{Number(l.returned_damaged_qty) > 0 ? ` (${Number(l.returned_damaged_qty).toLocaleString('en-IN')} dmg)` : ''}</span>
                            : <span className="text-gray-300">—</span>
                        })()}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-500">{stockErr ? '—' : Number(avail).toLocaleString('en-IN')}</td>
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
        isKeeper={isKeeper}
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

      {/* Signed gate pass — proof of receipt on file */}
      {gpDocs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signed gate pass</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {gpDocs.map(d => (
              <div key={d.id}>
                {d.isPdf ? (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-700 underline underline-offset-2">
                    View signed gate pass (PDF) · {formatDateTime(d.created_at)}
                  </a>
                ) : (
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.url} alt="Signed gate pass" className="max-h-96 rounded border border-gray-200" />
                    <figcaption className="mt-1 text-xs text-gray-500">Received &amp; signed · uploaded {formatDateTime(d.created_at)}</figcaption>
                  </figure>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
                .map((e: { id: string; from_status: string | null; to_status: string; action_at: string; remarks: string | null; actor_id: string | null }) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className="text-gray-400 text-xs mt-0.5 w-36 flex-shrink-0">{formatDateTime(e.action_at)}</span>
                  <div className="min-w-0">
                    <p className="text-gray-800">
                      {e.from_status ? <span className="text-gray-500">{e.from_status} →</span> : null} <b>{e.to_status}</b>
                      {e.actor_id && <span className="text-gray-500"> · by {actorName.get(e.actor_id) ?? 'Someone'}</span>}
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

function LineStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="tabular-nums font-medium text-gray-800">{value}</p>
    </div>
  )
}
