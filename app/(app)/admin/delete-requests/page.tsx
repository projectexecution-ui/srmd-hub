import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import DeleteRequestsList from './DeleteRequestsList'

export const dynamic = 'force-dynamic'

export default async function DeleteRequestsPage() {
  const profile = await getMyProfile()
  if (!profile) redirect('/login')
  // Anyone whose role is configured as an approver elsewhere will be able
  // to read pending rows via RLS — but the page is gated to admin /
  // Portal Owner here to keep the entry point obvious.
  if (profile.role !== 'admin' && !profile.is_portal_owner) redirect('/admin')

  const supabase = await createClient()
  const { data: pending } = await supabase
    .from('delete_requests')
    .select('id, module_slug, doc_table, doc_id, doc_label, requested_by, reason, status, created_at, decided_by, decided_at, decision_reason')
    .order('created_at', { ascending: false })
    .limit(200)

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, full_name, email')

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Delete Requests"
        back="/admin"
        subtitle="Pending and recent delete requests across all modules"
      />
      <Card className="p-4 bg-amber-50 border-amber-200 text-sm text-amber-900">
        These are deletes that a role can&apos;t do directly — they need approval here.
        Approving marks the request approved. You still need to perform the actual
        delete from the module&apos;s own page.
      </Card>
      <DeleteRequestsList
        initial={pending ?? []}
        profiles={profiles ?? []}
      />
    </div>
  )
}
