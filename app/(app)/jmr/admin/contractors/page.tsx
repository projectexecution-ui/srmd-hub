import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, Truck } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function JmrContractorsPage() {
  const perms = await requirePermission('jmr-admin', 'view')
  const canEdit = can(perms, 'jmr-admin', 'edit')
  const supabase = await createClient()

  const { data: contractors } = await supabase
    .from('jmr_contractors')
    .select('id, name, gst_number, contact_person, phone, status')
    .order('name')

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-gray-500">{contractors?.length ?? 0} contractor{contractors?.length === 1 ? '' : 's'}</p>
        {canEdit && (
          <Button asChild size="sm">
            <Link href="/jmr/admin/contractors/new"><Plus className="h-4 w-4" />New contractor</Link>
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {contractors && contractors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">GST</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {contractors.map(c => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/jmr/admin/contractors/${c.id}`} className="font-semibold text-blue-700 hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{c.gst_number || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{c.contact_person || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{c.phone || '—'}</td>
                    <td className="px-4 py-3"><StatusPill v={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Truck className="h-10 w-10" />}
            title="No contractors yet"
            action={canEdit ? <Button asChild size="sm"><Link href="/jmr/admin/contractors/new">Add first contractor</Link></Button> : null}
          />
        )}
      </Card>
    </>
  )
}

function StatusPill({ v }: { v: string }) {
  const cls = v === 'active'
    ? 'bg-green-50 text-green-700'
    : 'bg-gray-100 text-gray-600'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{v}</span>
}
