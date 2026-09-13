import Link from 'next/link'
import { loadCounts, loadEntries, loadItems, loadLists, storableLocations } from '@/lib/stores/queries'
import { Tile, Section, Empty, Scroller, th, td, tdNum, StageChip, RegisterChip, When } from './ui'
import { fmtQty } from '@/lib/stores/core'

export const dynamic = 'force-dynamic'

/**
 * The overview. Aksha's V1 rule: every tile carries a live count of what is
 * waiting, so the landing page answers "is anything on me?" without a click.
 */
export default async function StoresHome() {
  const [counts, recent, lists, items] = await Promise.all([
    loadCounts(), loadEntries({ limit: 12 }), loadLists(), loadItems(),
  ])

  const places = storableLocations(lists).length
  const setupDone = places > 0 && items.length > 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile href="/stores/gate?stage=gate" label="Waiting on storekeeper" count={counts.toComplete}
          sub="Vehicles recorded at the gate, not yet counted in" tone="amber" />
        <Tile href="/stores/requests?status=pending" label="Requests to approve" count={counts.pendingRequests}
          sub="With Mayank / Kanti" tone="blue" />
        <Tile href="/stores/returnables" label="Still to come back" count={counts.returnablesOut}
          sub="Returnable material out on site" tone="amber" />
        <Tile href="/stores/stock" label="Items held" count={counts.itemsHeld}
          sub="Distinct items with stock on hand" tone="emerald" />
      </div>

      {!setupDone && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-[13.5px] font-bold text-blue-900">Start here — the store is empty</p>
          <p className="text-[12.5px] text-blue-900/90 mt-1 max-w-2xl">
            Nothing can be issued until there is stock, because an item can only be picked from stock.
            Two things first:{' '}
            {places === 0
              ? <>add the places material sits in, then the items that sit in them.</>
              : <>add the items you hold, then set their opening quantity.</>}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Link href="/stores/masters" className="inline-flex items-center rounded-lg bg-indigo-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-800 min-h-[44px]">
              Open Masters
            </Link>
            <Link href="/stores/stock" className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 min-h-[44px]">
              Set opening stock
            </Link>
          </div>
          <p className="text-[11.5px] text-blue-900/70 mt-2.5">
            When the Odoo export arrives this becomes one upload instead.
          </p>
        </div>
      )}

      <Section
        title="The gate, most recent first"
        note="Every vehicle in and every issue out, across all projects"
        right={
          <Link href="/stores/gate" className="text-[12.5px] font-semibold text-indigo-700 hover:underline">
            Open the register →
          </Link>
        }
      >
        {recent.length === 0 ? (
          <Empty
            title="Nothing has been through the gate yet"
            hint="The first entry is Security recording a vehicle. Everything else follows from it."
            action={
              <Link href="/stores/gate" className="inline-flex items-center rounded-lg bg-indigo-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-800 min-h-[44px]">
                Record a vehicle
              </Link>
            }
          />
        ) : (
          <Scroller min={820}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Number</th>
                  <th className={th}>Register</th>
                  <th className={th}>Party</th>
                  <th className={th}>Vehicle</th>
                  <th className={th}>Project</th>
                  <th className={`${th} text-right`}>Lines</th>
                  <th className={th}>Stage</th>
                  <th className={th}>When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(e => (
                  <tr key={e.id} className={e.stage === 'void' ? 'opacity-50' : ''}>
                    <td className={td}>
                      <Link href={`/stores/gate/${e.id}`} className="font-mono text-[12.5px] font-semibold text-indigo-700 hover:underline">
                        {e.no}
                      </Link>
                    </td>
                    <td className={td}><RegisterChip register={e.register} /></td>
                    <td className={td}>{e.partyName ?? <span className="text-gray-400">—</span>}</td>
                    <td className={`${td} font-mono text-[12px]`}>{e.vehicleNo ?? <span className="text-gray-400">—</span>}</td>
                    <td className={td}>{e.projectName ?? <span className="text-gray-400">not set</span>}</td>
                    <td className={tdNum}>{e.lineCount ? `${e.lineCount} · ${fmtQty(e.totalQty)}` : '—'}</td>
                    <td className={td}><StageChip stage={e.stage} /></td>
                    <td className={td}><When at={e.entryAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        )}
      </Section>

      <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
        <p className="text-[12.5px] font-bold text-gray-800">What is not built yet</p>
        <ul className="text-[12.5px] text-gray-600 mt-1.5 space-y-1 list-disc pl-5">
          <li>Photos at the gate — the table and the bucket exist; the camera is not wired until you settle
            how long pictures are kept (query 5).</li>
          <li>The five reports with period / vendor / discipline filters. Stock and To-return are here; the
            other three are the same register filtered, once the shape is agreed.</li>
          <li>Vendor returns going back out — the debt is tracked, clearing it is the next step.</li>
        </ul>
      </div>
    </div>
  )
}
