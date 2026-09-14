import Link from 'next/link'
import {
  loadRequests, loadItems, loadLists, loadStock, storableLocations, locationLabel, listsOf,
  loadProjectOptions,
} from '@/lib/stores/queries'
import { RequestsClient } from './RequestsClient'

export const dynamic = 'force-dynamic'

const FILTERS = [
  { key: 'pending',  label: 'To approve' },
  { key: 'approved', label: 'To issue' },
  { key: '',         label: 'Everything' },
]

export default async function RequestsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams
  const active = FILTERS.find(f => f.key === status)?.key ?? 'pending'

  const [requests, items, lists, stock, projects] = await Promise.all([
    loadRequests({ status: active || null }),
    loadItems(),
    loadLists(),
    loadStock(),
    loadProjectOptions(),
  ])

  const locations = storableLocations(lists).map(l => ({ id: l.id, label: locationLabel(lists, l.id) ?? l.name }))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <Link
            key={f.key || 'all'}
            href={f.key ? `/stores/requests?status=${f.key}` : '/stores/requests?status='}
            className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold min-h-[44px] inline-flex items-center ${
              active === f.key ? 'bg-indigo-700 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <RequestsClient
        requests={requests}
        projects={projects}
        items={items.filter(i => i.isActive).map(i => ({ id: i.id, name: i.name, unit: i.unit }))}
        locations={locations}
        modes={listsOf(lists, 'delivery_mode').filter(m => m.isActive).map(m => ({ id: m.id, name: m.name }))}
        stock={stock.map(s => ({ itemId: s.itemId, locationId: s.locationId, qty: s.qty }))}
      />
    </div>
  )
}
