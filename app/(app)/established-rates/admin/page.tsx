import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { TaxonomyEditor } from './taxonomy-editor'
import { ImportPanel } from './import-panel'

export const dynamic = 'force-dynamic'

export default async function EstablishedRatesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  // The permission matrix decides who administers this module (admin holds
  // can_admin today). Going through requirePermission also honours the
  // module's on/off switch, which a bare role check never did.
  await requirePermission('established-rates', 'admin', '/established-rates')
  const sp = await searchParams
  const tab = sp.tab === 'import' ? 'import' : 'taxonomy'

  const supabase = await createClient()
  const [discRes, catRes, subRes, logsRes] = await Promise.all([
    supabase.from('est_disciplines').select('*').order('display_order').order('code'),
    supabase.from('est_categories').select('*').order('display_order').order('code'),
    supabase.from('est_subcategories').select('*').order('name'),
    supabase.from('est_upload_log').select('*').order('created_at', { ascending: false }).limit(20),
  ])

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Established Rates — Admin"
        back="/established-rates"
        subtitle="Taxonomy and IN4 import"
      />

      <Card>
        <CardContent className="pt-3 pb-3 flex gap-2 text-sm border-b border-gray-100">
          <a href="/established-rates/admin"
             className={`px-3 py-1.5 rounded-md font-medium ${tab === 'taxonomy' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            Taxonomy
          </a>
          <a href="/established-rates/admin?tab=import"
             className={`px-3 py-1.5 rounded-md font-medium ${tab === 'import' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            Import
          </a>
        </CardContent>
      </Card>

      {tab === 'taxonomy' ? (
        <TaxonomyEditor
          disciplines={discRes.data ?? []}
          categories={catRes.data ?? []}
          subcategories={subRes.data ?? []}
        />
      ) : (
        <ImportPanel uploadLogs={logsRes.data ?? []} />
      )}
    </div>
  )
}
