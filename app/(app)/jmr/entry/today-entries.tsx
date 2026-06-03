import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'
import { formatINR, todayISO } from '@/lib/jmr/format'
import { ChevronDown } from 'lucide-react'

// Engineers cannot edit submitted entries (lock-on-submit RLS).
// We just list today's entries for verification — no inline edit
// affordance.
export async function TodayEntries() {
  const supabase = await createClient()
  const today = todayISO()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: entries } = await supabase
    .from('jmr_daily_entries')
    .select(`
      id, entry_date, quantity, amount, status, created_at,
      jmr_items ( name, unit ),
      jmr_contractors ( name ),
      projects!jmr_daily_entries_project_id_fkey ( name )
    `)
    .eq('logged_by_user_id', user.id)
    .eq('entry_date', today)
    .order('created_at', { ascending: false })

  const total = entries?.reduce((s, e) => s + Number(e.amount), 0) ?? 0

  return (
    <Card className="p-3">
      <details className="group">
        <summary className="flex items-center justify-between cursor-pointer list-none">
          <div>
            <p className="text-sm font-bold text-gray-900">Today&apos;s entries</p>
            <p className="text-xs text-gray-500">{entries?.length ?? 0} entries · {formatINR(total)} value</p>
          </div>
          <ChevronDown className="h-4 w-4 text-gray-500 group-open:rotate-180 transition-transform" />
        </summary>
        <div className="mt-3 space-y-2">
          {(!entries || entries.length === 0) && (
            <p className="text-xs text-gray-500">No entries yet today.</p>
          )}
          {entries?.map(e => {
            // @ts-expect-error supabase relation typing is loose
            const item = e.jmr_items?.name ?? 'Item'
            // @ts-expect-error supabase relation typing is loose
            const unit = e.jmr_items?.unit ?? ''
            // @ts-expect-error supabase relation typing is loose
            const contractor = e.jmr_contractors?.name ?? '—'
            // @ts-expect-error supabase relation typing is loose
            const project = e.projects?.name ?? '—'
            return (
              <div key={e.id} className="flex items-start justify-between gap-2 py-2 border-t border-gray-100 first:border-t-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item}</p>
                  <p className="text-xs text-gray-500 truncate">{project} · {contractor}</p>
                  <p className="text-xs text-gray-500">{Number(e.quantity)} {unit}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-emerald-700">{formatINR(Number(e.amount))}</p>
                  <span
                    className="text-[10px] text-gray-400"
                    title="Submitted entries are locked. Only admin / head can amend."
                  >
                    locked
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </details>
    </Card>
  )
}
