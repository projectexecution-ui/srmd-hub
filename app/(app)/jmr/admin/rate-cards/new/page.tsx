import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { RateForm } from '../rate-form'

export const dynamic = 'force-dynamic'

export default async function NewRatePage() {
  await requirePermission('jmr-admin', 'edit')
  const supabase = await createClient()
  const [c, i, p] = await Promise.all([
    supabase.from('jmr_contractors').select('id, name').eq('status', 'active').order('name'),
    supabase.from('jmr_items').select('id, name, unit').eq('is_active', true).order('name'),
    supabase.from('projects').select('id, name').order('name'),
  ])
  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold mb-4">New rate card</h2>
      <RateForm contractors={c.data ?? []} items={i.data ?? []} projects={p.data ?? []} />
    </Card>
  )
}
