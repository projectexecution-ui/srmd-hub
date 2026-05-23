import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { RateForm } from '../rate-form'
import { formatINR, formatDateIN } from '@/lib/jmr/format'

export const dynamic = 'force-dynamic'

export default async function EditRatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('jmr-admin', 'edit')
  const { id } = await params
  const supabase = await createClient()
  const [r, c, i, p, log] = await Promise.all([
    supabase.from('jmr_rate_cards').select('*').eq('id', id).single(),
    supabase.from('jmr_contractors').select('id, name').order('name'),
    supabase.from('jmr_items').select('id, name, unit').order('name'),
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('jmr_rate_change_log').select('old_rate, new_rate, reason, changed_at').eq('rate_card_id', id).order('changed_at', { ascending: false }).limit(20),
  ])
  if (!r.data) notFound()

  return (
    <>
      <Card className="p-4 mb-4">
        <h2 className="text-lg font-bold mb-4">Edit rate card</h2>
        <RateForm
          contractors={c.data ?? []}
          items={i.data ?? []}
          projects={p.data ?? []}
          initial={r.data}
          rateCardId={id}
        />
      </Card>
      {log.data && log.data.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-bold mb-2 text-gray-700">Rate change history</h3>
          <ul className="text-xs space-y-1">
            {log.data.map((entry, i) => (
              <li key={i} className="flex items-center gap-3 text-gray-600">
                <span className="text-gray-400">{formatDateIN(entry.changed_at)}</span>
                <span className="line-through">{formatINR(Number(entry.old_rate))}</span>
                <span className="text-gray-700">→ {formatINR(Number(entry.new_rate))}</span>
                {entry.reason && <span className="italic text-gray-500">— {entry.reason}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
