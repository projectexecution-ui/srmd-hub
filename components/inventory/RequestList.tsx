import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { RequestStatusPill } from '@/components/inventory/RequestStatusPill'
import { formatDate } from '@/lib/utils'

interface Row {
  id: string
  request_no: string
  status: string
  urgency: string
  purpose: string | null
  created_at: string | null
  projects: { code: string; name: string } | { code: string; name: string }[] | null
  inv_warehouses: { code: string } | { code: string }[] | null
}

export function RequestList({ rows, emptyText }: { rows: Row[]; emptyText: string }) {
  if (rows.length === 0) {
    return <Card className="p-8 text-center text-sm text-gray-500">{emptyText}</Card>
  }
  return (
    <Card className="divide-y divide-gray-100">
      {rows.map(r => {
        const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
        const wh = Array.isArray(r.inv_warehouses) ? r.inv_warehouses[0] : r.inv_warehouses
        return (
          <Link key={r.id} href={`/inventory/requests/${r.id}`}
            className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-bold text-blue-700">{r.request_no}</span>
                <RequestStatusPill status={r.status} />
                {r.urgency !== 'normal' && (
                  <span className={`text-[10px] uppercase font-bold ${r.urgency === 'emergency' ? 'text-rose-700' : 'text-amber-700'}`}>
                    {r.urgency}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {proj?.code ?? '—'}{wh?.code ? ` · ${wh.code}` : ''} · {r.created_at ? formatDate(r.created_at) : ''}
              </p>
              {r.purpose && <p className="text-xs text-gray-600 mt-1 line-clamp-1">{r.purpose}</p>}
            </div>
          </Link>
        )
      })}
    </Card>
  )
}
