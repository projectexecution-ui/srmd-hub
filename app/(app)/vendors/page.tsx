import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Truck, Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function VendorsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user ? await supabase.from('profiles').select('role').eq('id', user.id).single() : { data: null }
  const canWrite = profile?.role === 'admin' || profile?.role === 'uploader'

  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, name, gstin, contact_person, contact_phone')
    .order('name')

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="Vendors" subtitle={`${vendors?.length ?? 0} vendor${vendors?.length === 1 ? '' : 's'}`}>
        {canWrite && (
          <Button asChild size="sm">
            <Link href="/vendors/new">
              <Plus className="h-4 w-4" /> New Vendor
            </Link>
          </Button>
        )}
      </PageHeader>
      <Card className="overflow-hidden">
        {vendors && vendors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">GSTIN</th>
                  <th className="px-4 py-3 font-semibold">Contact</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map(v => (
                  <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/vendors/${v.id}`} className="font-semibold text-blue-700 hover:underline">{v.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{v.gstin || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{v.contact_person || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{v.contact_phone || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Truck className="h-10 w-10" />}
            title="No vendors yet"
            action={canWrite ? (
              <Button asChild size="sm"><Link href="/vendors/new">Add first vendor</Link></Button>
            ) : null}
          />
        )}
      </Card>
    </div>
  )
}
