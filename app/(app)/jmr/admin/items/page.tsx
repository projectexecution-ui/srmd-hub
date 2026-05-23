import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, Package } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function JmrItemsPage() {
  const perms = await requirePermission('jmr-admin', 'view')
  const canEdit = can(perms, 'jmr-admin', 'edit')
  const supabase = await createClient()

  const { data: items } = await supabase
    .from('jmr_items')
    .select('id, name, category, unit, is_active')
    .order('category')
    .order('name')

  const grouped = (items ?? []).reduce<Record<string, typeof items>>((acc, it) => {
    const k = it.category
    if (!acc[k]) acc[k] = []
    acc[k]!.push(it)
    return acc
  }, {})

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-gray-500">{items?.length ?? 0} item{items?.length === 1 ? '' : 's'} in catalog</p>
        {canEdit && (
          <Button asChild size="sm">
            <Link href="/jmr/admin/items/new"><Plus className="h-4 w-4" />New item</Link>
          </Button>
        )}
      </div>
      {items && items.length > 0 ? (
        Object.entries(grouped).map(([cat, list]) => (
          <Card key={cat} className="mb-4 overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-bold uppercase tracking-wider text-gray-700">
              {cat === 'equipment' ? 'Equipment supply' : 'Manpower'}
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Unit</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {(list ?? []).map(it => (
                  <tr key={it.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <Link href={`/jmr/admin/items/${it.id}`} className="font-medium text-blue-700 hover:underline">{it.name}</Link>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{it.unit}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${it.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {it.is_active ? 'active' : 'inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      ) : (
        <Card>
          <EmptyState
            icon={<Package className="h-10 w-10" />}
            title="No items in catalog yet"
            action={canEdit ? <Button asChild size="sm"><Link href="/jmr/admin/items/new">Add first item</Link></Button> : null}
          />
        </Card>
      )}
    </>
  )
}
