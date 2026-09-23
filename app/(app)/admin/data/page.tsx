import Link from 'next/link'
import { ArrowRight, FileSpreadsheet, Link2, History } from 'lucide-react'
import { adminViewer } from '@/lib/admin/viewer'
import { doorById, resolveTab, visibleTabs } from '@/lib/admin/doors'
import { AdminDoor, NothingHere } from '../Door'
import { In4Body } from '../in4/body'
import { IntakeBody } from './IntakeBody'
import { ManualFallbackBody } from '../manual-upload/body'
import { MastersBody } from '@/app/(app)/masters/body'
import { DeleteRequestsBody } from '../delete-requests/body'
import { RecycleBinBody } from '../recycle-bin/body'

export const dynamic = 'force-dynamic'

/**
 * Data — the fourth door (Aksha, 23 Sep 2026, E1).
 *
 *   IN4 live sync    every feed: last run, comparison, live switch
 *   Manual fallback  when IN4 cannot be read (also its own page, for the
 *                    people granted it under People › Powers)
 *   Imports          the Excel budget import and the BPH → project links
 *   Masters          the lists everything points at — this is where Masters
 *                    lives now; it left the sidebar
 *   Deleted things   delete requests, the recycle bin, the audit log
 */
export default async function DataPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [v, { tab: requested }] = await Promise.all([adminViewer(), searchParams])
  const door = doorById('data')!
  const tabs = visibleTabs(door, v)
  const current = resolveTab(door, requested, v)
  if (!current) return <NothingHere door={door} />

  return (
    <AdminDoor door={door} tabs={tabs} current={current}>
      {current.id === 'in4' && <In4Body />}
      {current.id === 'intake' && <IntakeBody />}
      {current.id === 'fallback' && <ManualFallbackBody />}
      {current.id === 'imports' && <Imports />}
      {current.id === 'masters' && <MastersBody />}
      {current.id === 'deleted' && (
        <div className="space-y-6">
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-2">Delete requests</h2>
            <DeleteRequestsBody />
          </section>
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-2">Recycle bin</h2>
            <RecycleBinBody />
          </section>
          <Link href="/cost-control/audit" className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 min-h-[44px] hover:bg-gray-50">
            <span className="flex items-center gap-2.5"><History className="h-4 w-4 text-gray-500" /><span><span className="block text-sm font-medium text-gray-900">Audit log</span><span className="block text-xs text-gray-500">Who changed what in Cost Control, and when</span></span></span>
            <ArrowRight className="h-4 w-4 text-gray-400" />
          </Link>
        </div>
      )}
    </AdminDoor>
  )
}

/** Two forms, each its own page because each is a multi-step upload. Listed
 *  here so "get data in" has one door. */
function Imports() {
  const items = [
    { href: '/cost-control/import', icon: FileSpreadsheet, label: 'Excel budget import', hint: 'Load an Internal Estimate workbook into a project' },
    { href: '/cost-control/import/bph', icon: Link2, label: 'BPH → project links', hint: 'Which Budget-Hub project feeds which Internal Estimate' },
  ]
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map(i => (
        <li key={i.href}>
          <Link href={i.href} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 min-h-[44px] hover:border-indigo-300 hover:bg-indigo-50/30">
            <span className="h-9 w-9 rounded-lg bg-gray-50 border border-gray-200 grid place-items-center flex-shrink-0"><i.icon className="h-4 w-4 text-gray-600" /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold text-gray-900">{i.label}</span><span className="block text-xs text-gray-500">{i.hint}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
