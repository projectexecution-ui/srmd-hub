import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { loadItemCard } from '@/lib/stores/queries'
import { itemHistory, moveWord } from '@/lib/stores/desk'
import { fmtQty } from '@/lib/stores/core'
import { formatDateTime, formatINR, formatNumber } from '@/lib/utils'
import { Section, Empty, Scroller, th, thNum, td, tdNum } from '../../ui'
import { guardStoreTab } from '../../guard'

export const dynamic = 'force-dynamic'

/**
 * One item's bin card.
 *
 * Aksha, 16 Sep 2026: "Item card". "Where did the 140 SqFt go?" could only be
 * answered by opening gate entries one at a time until one of them mentioned
 * the item.
 *
 * Every movement, newest first, with the balance as it stood after each one —
 * folded from the same ledger as the stock screen, so the figure at the top of
 * this page is the figure on that one by construction, not by agreement.
 */
export default async function ItemCardPage({ params }: { params: Promise<{ itemId: string }> }) {
  const blocked = await guardStoreTab('stock')
  if (blocked) return blocked

  const { itemId } = await params
  const card = await loadItemCard(itemId)
  if (!card) notFound()

  const { item, moves } = card
  const rows = itemHistory(moves)
  const total = item.at.reduce((s, a) => s + a.qty, 0)
  const value = item.at.reduce((s, a) => s + (a.value ?? 0), 0)
  const unpriced = item.at.some(a => a.value == null)

  return (
    <div className="space-y-5">
      <Link href="/stores/stock" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-indigo-700 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to stock
      </Link>

      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-2.5">
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-gray-900">{item.name}</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              {item.discipline ?? <span className="text-amber-800 font-semibold">No discipline — requests for it reach no approver</span>}
              {' · '}{item.unit}
              {item.lastRate != null && <> · last rate {formatINR(item.lastRate)}</>}
            </p>
          </div>
          {item.in4MaterialId != null && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-900">
              IN4 #{item.in4MaterialId}
            </span>
          )}
          {!item.isActive && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10.5px] font-semibold text-gray-700">Retired</span>
          )}
          <div className="ml-auto text-right">
            <p className="text-2xl font-bold text-gray-900 tabular-nums leading-none">
              {fmtQty(total)} <span className="text-[13px] font-semibold text-gray-500">{item.unit}</span>
            </p>
            <p className="text-[12px] text-gray-500 mt-1 tabular-nums">
              {value > 0 ? formatINR(value) : '—'}
              {unpriced && <span className="text-amber-700"> understated</span>}
            </p>
          </div>
        </div>

        {/* Where it is, right now. The whole point of asking. */}
        <div className="mt-4 flex flex-wrap gap-2">
          {item.at.length === 0 ? (
            <p className="text-[12.5px] text-gray-500">
              None in stock anywhere. It has to come in through the gate before it can be issued.
            </p>
          ) : item.at.map(a => (
            <span
              key={a.locationId ?? 'none'}
              className={`inline-flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] ${
                a.qty < 0 ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-gray-200 bg-gray-50 text-gray-800'
              }`}
            >
              <b className="tabular-nums">{fmtQty(a.qty)}</b>
              <span className="text-gray-500">{item.unit} at</span>
              <b>{a.label}</b>
            </span>
          ))}
        </div>
      </div>

      {/* What was changed about the ITEM, as opposed to what moved.
          Aksha, 16 Sep 2026: "i will need all the data should be recorded and
          what all changes is done to that item should also come". A rate that
          moves with no name against it is a rate nobody can defend later. */}
      {item.edits.length > 0 && (
        <details className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer list-none min-h-[44px] flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-gray-900">What was changed about this item</span>
            <span className="text-[12px] text-gray-500">
              {item.edits.length} change{item.edits.length === 1 ? '' : 's'}
              {' · last '}{formatDateTime(item.edits[0].changedAt)}
            </span>
            <span className="ml-auto text-[12px] font-semibold text-indigo-700">Show</span>
          </summary>
          <ul className="border-t border-gray-100 divide-y divide-gray-100">
            {item.edits.map(e => (
              <li key={e.id} className="px-4 py-2.5">
                <p className="text-[12.5px] text-gray-800">
                  <b>{e.field}</b>{' '}
                  <span className="text-gray-500 line-through">{e.oldValue || 'empty'}</span>
                  {' → '}
                  <span className="font-semibold">{e.newValue || 'empty'}</span>
                </p>
                <p className="text-[11.5px] text-gray-400">
                  {e.changedBy ?? 'Someone'} · {formatDateTime(e.changedAt)}
                  {e.reason ? ` · ${e.reason}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Section
        title="Every movement"
        note={`${formatNumber(rows.length, 0)} in all — newest first, with the balance after each one`}
      >
        {rows.length === 0 ? (
          <Empty
            title="This item has never moved"
            hint="It is in the item list but nothing has ever come in or gone out. Set an opening quantity on the stock page, or let a gate entry bring it in."
          />
        ) : (
          <>
            {/* Desktop. */}
            <div className="hidden md:block">
              <Scroller min={860}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>When</th>
                      <th className={th}>What</th>
                      <th className={thNum}>Qty</th>
                      <th className={thNum}>Balance</th>
                      <th className={th}>Where</th>
                      <th className={th}>Entry</th>
                      <th className={th}>Party / project</th>
                      <th className={thNum}>Rate</th>
                      <th className={th}>Who</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(m => (
                      <tr key={m.id}>
                        <td className={`${td} whitespace-nowrap text-gray-500`}>{formatDateTime(m.movedAt)}</td>
                        <td className={td}>
                          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                            m.kind === 'opening' ? 'bg-gray-200 text-gray-700'
                              : m.qty >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                          }`}>
                            {moveWord(m.kind, m.qty)}
                          </span>
                        </td>
                        <td className={`${tdNum} font-semibold ${m.qty < 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                          {m.qty > 0 ? '+' : ''}{fmtQty(m.qty)}
                        </td>
                        <td className={`${tdNum} font-bold`}>{fmtQty(m.balance)}</td>
                        <td className={td}>{m.place ?? <span className="text-gray-400">—</span>}</td>
                        <td className={td}>
                          {m.entryId
                            ? <Link href={`/stores/gate/${m.entryId}`} className="font-mono text-[12px] font-semibold text-indigo-700 hover:underline">{m.entryNo}</Link>
                            : <span className="text-gray-400 text-[12px]">{m.note ?? '—'}</span>}
                        </td>
                        <td className={td}>
                          {m.party ?? m.project ?? <span className="text-gray-400">—</span>}
                          {m.party && m.project && <span className="block text-[11.5px] text-gray-500">{m.project}</span>}
                        </td>
                        <td className={tdNum}>{m.rate == null ? '—' : formatINR(m.rate)}</td>
                        <td className={`${td} text-gray-500`}>{m.who ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroller>
            </div>

            {/* Phone. */}
            <ul className="md:hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {rows.map(m => (
                <li key={m.id} className="px-4 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold shrink-0 ${
                      m.kind === 'opening' ? 'bg-gray-200 text-gray-700'
                        : m.qty >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
                    }`}>
                      {moveWord(m.kind, m.qty)}
                    </span>
                    <span className={`text-[13px] font-bold tabular-nums ${m.qty < 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                      {m.qty > 0 ? '+' : ''}{fmtQty(m.qty)}
                    </span>
                    <span className="text-[12px] text-gray-500 tabular-nums">→ {fmtQty(m.balance)}</span>
                    <span className="ml-auto text-[11.5px] text-gray-400 whitespace-nowrap">{formatDateTime(m.movedAt)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-gray-500">
                    {m.entryId
                      ? <Link href={`/stores/gate/${m.entryId}`} className="font-mono font-semibold text-indigo-700">{m.entryNo}</Link>
                      : <span>{m.note ?? '—'}</span>}
                    {m.place && <span>· {m.place}</span>}
                    {(m.party ?? m.project) && <span>· {m.party ?? m.project}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  )
}
