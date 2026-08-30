import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadItemLists } from '@/lib/revamp/masters'

export const dynamic = 'force-dynamic'

/** Items master — for now, the four lists laid side by side so the size of the
 *  duplication is a fact rather than an assertion. Merging them is a decision
 *  with consequences (rates, stock, history all point at these ids), so this
 *  screen deliberately measures before it proposes. */
export default async function ItemsMasterPage() {
  await requirePermission('cost-control', 'view')
  const lists = await loadItemLists()
  const total = lists.reduce((s, l) => s + l.count, 0)
  const biggest = lists.reduce((a, b) => (a.count >= b.count ? a : b))

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Items"
        back="/masters"
        subtitle="The same materials are held in four separate lists today."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-900">
          {total.toLocaleString('en-IN')} item records across {lists.length} lists
        </p>
        <p className="text-xs text-amber-800 mt-1">
          Add cement in one and the other three do not know. A rate set against one list&apos;s id
          cannot be read by a screen using another&apos;s.
        </p>
      </div>

      <div className="space-y-2">
        {lists.map(l => {
          const share = total > 0 ? Math.round((l.count / total) * 100) : 0
          return (
            <div key={l.name} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">{l.name}</p>
                <p className="text-sm font-bold tabular-nums text-gray-900">{l.count.toLocaleString('en-IN')}</p>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{l.note}</p>
              <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={l.name === biggest.name ? 'h-full bg-indigo-500' : 'h-full bg-gray-300'}
                  style={{ width: `${share}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-bold text-gray-900">What merging these would take</h2>
        <ol className="mt-2 space-y-1.5 text-xs text-gray-600 list-decimal pl-4">
          <li>
            <b className="text-gray-800">{biggest.name}</b> becomes the one list — it is the biggest and it
            is fed by the IN4 uploads, so it stays current on its own.
          </li>
          <li>Match the other three onto it by name and unit, and show every match for review before anything moves.</li>
          <li>Leave whatever will not match in a visible holding list rather than guessing.</li>
          <li>Point rates, stock and history at the surviving ids; keep the old ids as aliases so nothing breaks.</li>
        </ol>
        <p className="mt-3 text-[11px] text-gray-400">
          Nothing on this screen writes. The merge is a decision to take with these numbers in front of you.
        </p>
      </div>
    </div>
  )
}
