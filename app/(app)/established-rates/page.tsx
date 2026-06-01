import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Settings, Upload, Tags } from 'lucide-react'
import { RateLibrary } from './rate-library'

export const dynamic = 'force-dynamic'

export default async function EstablishedRatesPage() {
  const perms = await requirePermission('established-rates', 'view')
  const canEdit = can(perms, 'established-rates', 'edit')
  const profile = await getMyProfile()
  const isAdmin = profile?.role === 'admin' || !!profile?.is_portal_owner

  const supabase = await createClient()
  const [discRes, catRes, subRes, rateRes, woRes, vendorRes, contractorRes, projectsRes] = await Promise.all([
    supabase.from('est_disciplines').select('*').eq('is_archived', false).order('display_order').order('code'),
    supabase.from('est_categories').select('*').eq('is_archived', false).order('display_order').order('code'),
    supabase.from('est_subcategories').select('*').eq('is_archived', false).order('name'),
    supabase.from('est_rates').select('*').order('rate_per_unit'),
    supabase.from('est_wo_history').select('*').order('from_date', { ascending: false }),
    supabase.from('vendors').select('id, name').order('name'),
    supabase.from('jmr_contractors').select('id, name').order('name'),
    supabase.from('projects').select('id, code, name, parent_project_id').order('code'),
  ])

  const disciplines  = discRes.data ?? []
  const categories   = catRes.data ?? []
  const subcategories = subRes.data ?? []
  const rates        = rateRes.data ?? []
  const woHistory    = woRes.data ?? []
  const vendors      = vendorRes.data ?? []
  const contractors  = contractorRes.data ?? []
  const projects     = projectsRes.data ?? []

  const totalRates = rates.length
  const totalItems = subcategories.length

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Established Rates"
        subtitle={totalItems > 0
          ? `${totalItems} rate-items · ${totalRates} rates across ${disciplines.length} disciplines`
          : 'Master rate catalogue — by Discipline, Category, Sub-category'}
      >
        {isAdmin && (
          <Button asChild size="sm" variant="outline">
            <Link href="/established-rates/admin"><Settings className="h-4 w-4" /> Admin</Link>
          </Button>
        )}
      </PageHeader>

      {totalItems === 0 ? (
        <Card className="p-8 text-center">
          <Tags className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-gray-900 mb-1">No rates yet</h2>
          <p className="text-sm text-gray-500 mb-5">
            Import your IN4 BOQ Abstract Report to seed the entire library in one click,
            or add taxonomy + rates manually from the admin page.
          </p>
          {isAdmin && (
            <div className="flex items-center gap-2 justify-center">
              <Button asChild size="sm">
                <Link href="/established-rates/admin#import"><Upload className="h-4 w-4" /> Import IN4 Excel</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/established-rates/admin"><Settings className="h-4 w-4" /> Add manually</Link>
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <RateLibrary
          disciplines={disciplines}
          categories={categories}
          subcategories={subcategories}
          rates={rates}
          woHistory={woHistory}
          vendors={vendors}
          contractors={contractors}
          projects={projects}
          canEdit={canEdit}
        />
      )}
    </div>
  )
}
