import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'
import DeleteRequestsList from './DeleteRequestsList'

/** Delete requests — the first half of Data › Deleted things (E1). The gate
 *  is the door's; RLS still limits the rows to what this person may see. */
export async function DeleteRequestsBody() {
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
    <div className="space-y-3">
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
