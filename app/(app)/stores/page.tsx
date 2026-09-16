import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowDownToLine, ArrowUpFromLine, AlertTriangle, CheckCircle2, Wrench } from 'lucide-react'
import {
  loadCounts, loadEntries, loadItems, loadLists, loadRequests, loadSetupHealth, storableLocations,
} from '@/lib/stores/queries'
import { getMyProfile } from '@/lib/auth'
import { Tile, StageChip, RegisterChip } from './ui'
import { formatDate, formatINR, formatNumber } from '@/lib/utils'
import {
  fmtQty, RETURNABLES_ON, approverLabel, canOpenStoreTab, homeStoreTab, storeTabHref,
} from '@/lib/stores/core'
import { mostUrgent, setupHealth, type Waiting } from '@/lib/stores/desk'

export const dynamic = 'force-dynamic'

/**
 * The overview. Aksha's V1 rule: every tile carries a live count of what is
 * waiting, so the landing page answers "is anything on me?" without a click.
 *
 * Three things were added on 16 Sep 2026, from the Round Two preview:
 *   · one amber line naming the single most overdue thing (the tiles count,
 *     but counting four things equally does not say which one is on fire)
 *   · what the stock is worth, with the caveat that makes the figure honest
 *   · a setup-health line where the "what is not built yet" box used to be
 *
 * The grey box went because it was a developer's note on a manager's screen.
 * What replaced it is the same size and says something he can act on.
 */
export default async function StoresHome() {
  // The section's own front door. Somebody whose job does not include the
  // overview is taken to the screen that does, rather than refused at it.
  const profile = await getMyProfile()
  if (!canOpenStoreTab(profile?.role, 'overview')) {
    redirect(storeTabHref(homeStoreTab(profile?.role)))
  }

  const [counts, recent, lists, items, pending, waitingIn, health] = await Promise.all([
    loadCounts(),
    loadEntries({ limit: 40 }),
    loadLists(),
    loadItems(),
    loadRequests({ status: 'pending' }),
    loadEntries({ stage: 'gate', limit: 50 }),
    loadSetupHealth(),
  ])

  const places = storableLocations(lists).length
  const setupDone = places > 0 && items.length > 0
  const notes = setupHealth(health)

  /* Everything waiting on anybody, on one scale, so the worst can be named. */
  const waiting: Waiting[] = [
    ...pending.map(r => ({
      kind: 'request' as const,
      no: r.no,
      href: '/stores/requests?status=pending',
      since: r.raisedAt,
      dueDay: r.neededBy,
      what: whatWasAsked(r),
      who: approverLabel(r.approvers),
    })),
    ...waitingIn.map(e => ({
      kind: 'gate' as const,
      no: e.no,
      href: `/stores/gate/${e.id}`,
      since: e.entryAt,
      what: `${e.partyName ?? 'A vehicle'} is at the gate, uncounted`,
      who: 'the storekeeper',
    })),
  ]
  const urgent = mostUrgent(waiting)

  return (
    <div className="space-y-6">
      {/* One line, and only the worst one. A banner that lists five things is
          a second table. */}
      {urgent ? (
        <Link
          href={urgent.href}
          className="flex flex-wrap items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 hover:bg-amber-100/70 min-h-[44px]"
        >
          <AlertTriangle className="h-4.5 w-4.5 shrink-0 text-amber-700" strokeWidth={2.2} />
          <p className="text-[13px] text-amber-950 min-w-0">
            <span className="font-mono font-bold">{urgent.no}</span>{' '}
            {urgent.line}
          </p>
          <span className="ml-auto text-[12.5px] font-bold text-amber-900 whitespace-nowrap">Open →</span>
        </Link>
      ) : (
        <p className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
          <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-700" strokeWidth={2.2} />
          Nothing is waiting on anybody — every vehicle has been counted in and every request is answered.
        </p>
      )}

      <div className={`grid grid-cols-2 gap-3 ${RETURNABLES_ON ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <Tile href="/stores/gate" label="Waiting on storekeeper" count={counts.toComplete}
          sub="Vehicles recorded at the gate, not yet counted in" tone="amber" />
        <Tile href="/stores/requests?status=pending" label="Requests to approve" count={counts.pendingRequests}
          sub="With Mayank / Kanti" tone="blue" />
        <Tile href="/stores/stock" label="Items held" count={counts.itemsHeld}
          sub="Distinct items with stock on hand" tone="emerald" />
        {/* The figure management asks for, with the reason it is low. Putting
            it on the page without the caveat would be worse than leaving it at
            the bottom of a 749-row table, which is where it was. */}
        <Tile
          href="/stores/stock"
          label="Stock we hold"
          value={formatINR(counts.stockValue)}
          sub={counts.unpricedRows > 0
            ? `Understated — ${formatNumber(counts.unpricedRows, 0)} of ${formatNumber(counts.heldRows, 0)} lines have no rate`
            : 'Every line has a rate'}
          tone={counts.unpricedRows > 0 ? 'slate' : 'emerald'}
        />
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

      {/* Where the "what is not built yet" box used to be. Only what is wrong
          is listed, and each thing links to where it is fixed — a health line
          that cannot be acted on is decoration. */}
      {notes.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Wrench className="h-4 w-4 shrink-0 text-gray-500" strokeWidth={2.2} />
            <p className="text-[12.5px] font-bold text-gray-800">Setup</p>
            <Link href="/stores/masters" className="ml-auto text-[12.5px] font-semibold text-indigo-700 hover:underline">
              Open Masters →
            </Link>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {notes.map(n => (
              <li key={n.key} className="text-[12.5px]">
                <Link
                  href={n.href}
                  className={`hover:underline ${n.serious ? 'font-semibold text-amber-900' : 'text-gray-600'}`}
                >
                  {n.serious && <span aria-hidden className="mr-1">●</span>}
                  {n.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** What a request is for, short enough to sit in one line of a banner. */
function whatWasAsked(r: Awaited<ReturnType<typeof loadRequests>>[number]): string {
  const first = r.lines[0]
  const where = r.projectName ? ` for ${r.projectName}` : ''
  if (!first) return `a request${where}`
  if (r.lines.length === 1) return `${first.itemName}, ${fmtQty(first.qty)} ${first.unit}${where}`
  return `${first.itemName} and ${r.lines.length - 1} more${where}`
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
