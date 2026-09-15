import Link from 'next/link'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { loadCounts, loadEntries, loadItems, loadLists, storableLocations } from '@/lib/stores/queries'
import { Tile, StageChip, RegisterChip } from './ui'
import { formatDate, formatNumber } from '@/lib/utils'
import { fmtQty, RETURNABLES_ON } from '@/lib/stores/core'

export const dynamic = 'force-dynamic'

/**
 * The overview. Aksha's V1 rule: every tile carries a live count of what is
 * waiting, so the landing page answers "is anything on me?" without a click.
 */
export default async function StoresHome() {
  const [counts, recent, lists, items] = await Promise.all([
    loadCounts(), loadEntries({ limit: 40 }), loadLists(), loadItems(),
  ])

  const places = storableLocations(lists).length
  const setupDone = places > 0 && items.length > 0

  return (
    <div className="space-y-6">
      <div className={`grid grid-cols-2 gap-3 ${RETURNABLES_ON ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <Tile href="/stores/gate" label="Waiting on storekeeper" count={counts.toComplete}
          sub="Vehicles recorded at the gate, not yet counted in" tone="amber" />
        <Tile href="/stores/requests?status=pending" label="Requests to approve" count={counts.pendingRequests}
          sub="With Mayank / Kanti" tone="blue" />
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

      {/* In on one side, out on the other.
          One table held both, interleaved, with the direction buried in a
          prefix on the number and a chip three columns away — so "what came in
          this week" could only be answered by reading every row. Two lists
          answer it by looking. They also fit without a sideways scroll, which
          the eight-column table never did on a laptop. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Flow
          direction="in"
          rows={recent.filter(e => e.direction === 'in')}
          title="Came in"
          note="Vehicles at the gate, newest first"
          empty="Nothing has come in yet"
          emptyHint="The first entry is Security recording a vehicle."
        />
        <Flow
          direction="out"
          rows={recent.filter(e => e.direction === 'out')}
          title="Went out"
          note="Issued to a project or handed back"
          empty="Nothing has gone out yet"
          emptyHint="Material leaves on an approved request."
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
        <p className="text-[12.5px] font-bold text-gray-800">What is not built yet</p>
        <ul className="text-[12.5px] text-gray-600 mt-1.5 space-y-1 list-disc pl-5">
          <li>Photos at the gate — the table and the bucket exist; the camera is not wired until you settle
            how long pictures are kept (query 5).</li>
          <li>Security’s check and video confirmation before a load is driven out.</li>
          <li>Notifications — nobody is told when a vehicle is waiting or a request needs approving.</li>
        </ul>
      </div>
    </div>
  )
}

/**
 * One direction's recent movements, as rows rather than a table.
 *
 * A row is two lines: what it is on top, who and where underneath. Eight
 * columns of which three were usually "—" is how the old table filled a
 * laptop's width to say very little; this says the same in half the space and
 * never scrolls sideways, so it reads the same on a phone.
 */
function Flow({
  direction, rows, title, note, empty, emptyHint,
}: {
  direction: 'in' | 'out'
  rows: Awaited<ReturnType<typeof loadEntries>>
  title: string
  note: string
  empty: string
  emptyHint: string
}) {
  const isIn = direction === 'in'
  const shown = rows.slice(0, 8)
  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <header className={`flex items-center gap-2.5 border-b px-4 py-3 ${
        isIn ? 'border-emerald-100 bg-emerald-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isIn ? 'bg-emerald-600' : 'bg-amber-600'} text-white`}>
          {isIn ? <ArrowDownToLine className="h-4 w-4" strokeWidth={2.2} />
                : <ArrowUpFromLine className="h-4 w-4" strokeWidth={2.2} />}
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold text-gray-900 leading-tight">{title}</h3>
          <p className="text-[11.5px] text-gray-500">{note}</p>
        </div>
        <span className="ml-auto text-[11.5px] font-semibold text-gray-400 tabular-nums">
          {rows.length > shown.length ? `${shown.length} of ${formatNumber(rows.length, 0)}` : null}
        </span>
      </header>

      {shown.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-gray-500">
          <span className="font-semibold text-gray-700">{empty}.</span> {emptyHint}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shown.map(e => (
            <li key={e.id} className={e.stage === 'void' ? 'opacity-50' : ''}>
              <Link
                href={`/stores/gate/${e.id}`}
                className="block px-4 py-2.5 hover:bg-gray-50 min-h-[44px]"
              >
                {/* Each side leads with the thing that side is about. Coming
                    in, that is who brought it. Going out, it is where it went
                    — an issue from our own stock has no supplier at all, so
                    leading with the party would print "—" on most rows. */}
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[12.5px] font-semibold text-indigo-700 shrink-0">
                    {e.no.replace(/^(In|Out):\s*/, '')}
                  </span>
                  <span className="truncate text-[13px] text-gray-900">
                    {isIn
                      ? e.partyName ?? <span className="text-gray-400">no name given</span>
                      : e.projectName ?? <span className="text-gray-400">project not set</span>}
                  </span>
                  <span className="ml-auto shrink-0 text-[11.5px] text-gray-400 tabular-nums">
                    {formatDate(e.entryAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-gray-500">
                  <RegisterChip register={e.register} />
                  {isIn
                    ? <span className={e.projectName ? '' : 'text-gray-400'}>
                        {e.projectName ?? 'project not set yet'}
                      </span>
                    : e.partyName && <span>to {e.partyName}</span>}
                  {e.lineCount > 0 && (
                    <span className="tabular-nums">
                      {formatNumber(e.lineCount, 0)} {e.lineCount === 1 ? 'item' : 'items'} · {fmtQty(e.totalQty)}
                    </span>
                  )}
                  {e.stage !== 'complete' && <span className="ml-auto"><StageChip stage={e.stage} /></span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={`/stores/gate?direction=${direction}`}
        className="block border-t border-gray-100 bg-gray-50/60 px-4 py-2.5 text-[12.5px] font-semibold text-indigo-700 hover:bg-gray-100 min-h-[44px]"
      >
        {isIn ? 'Open the gate register →' : 'See everything issued out →'}
      </Link>
    </section>
  )
}
