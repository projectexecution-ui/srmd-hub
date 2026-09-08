import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadMasterOverview, lastMirrorSync } from '@/lib/revamp/masters-in4'
import { formatDateTime } from '@/lib/utils'
import { In4Note } from './In4Note'
import { MasterSearchBox } from './MasterSearchBox'
import { ArrowRight, Landmark, FolderKanban, Users, Layers, Package, ListTree } from 'lucide-react'

export const dynamic = 'force-dynamic'

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  trusts: Landmark, projects: FolderKanban, contacts: Users, categories: Layers, items: Package, boq: ListTree,
}

/** Masters landing — the six lists of Aksha's mind map, one card each, with
 *  the real count on every card, a search across all six, and how fresh the
 *  mirror is. Nothing here writes: IN4 is the register, CT Hub reads it. */
export default async function MastersPage() {
  await requirePermission('cost-control', 'view')
  const [{ cards, in4, in4Error }, synced] = await Promise.all([loadMasterOverview(), lastMirrorSync()])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Masters"
        subtitle="The lists everything else points at — read from IN4, the system that already holds them."
      />
      <MasterSearchBox />
      <In4Note in4={in4} error={in4Error} what="the BOQ count" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c, i) => {
          const Icon = ICONS[c.key] ?? Layers
          return (
            <Link
              key={c.key}
              href={c.href}
              className="group rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors block min-h-[44px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900"><span className="text-gray-400 font-medium mr-1.5">{i + 1}</span>{c.label}</p>
                    <p className="text-[12px] text-gray-500 mt-0.5">{c.hint}</p>
                  </div>
                </div>
                <p className="text-lg font-bold tabular-nums text-gray-900 flex-shrink-0">
                  {c.total == null ? '—' : c.total.toLocaleString('en-IN')}
                </p>
              </div>
              <ul className="mt-2.5 space-y-0.5">
                {c.facts.map(f => <li key={f} className="text-[12px] text-gray-600">{f}</li>)}
              </ul>
              <p className="mt-2 text-[12px] font-semibold text-indigo-700 inline-flex items-center gap-1 group-hover:underline">
                Open <ArrowRight className="h-3 w-3" />
              </p>
            </Link>
          )
        })}
      </div>

      <p className="text-[12px] text-gray-500">
        Trusts, projects, BOQ: live from IN4 when opened. Contacts, categories, items: from the IN4 mirror{synced ? `, last synced ${formatDateTime(synced)}` : ''}.
        Everything is read-only here — a wrong name or number is fixed in IN4 and appears on the next sync.
      </p>
    </div>
  )
}
