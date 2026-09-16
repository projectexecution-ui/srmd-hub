import { Card } from '@/components/ui/card'
import { formatINR, formatINRCompact, formatNumber } from '@/lib/utils'

/** The bill on a phone.
 *
 *  Aksha, 16 Sep 2026, screen F of the look-and-feel preview: "Build it". Atm
 *  Heads approve from a handset, and a 17-column sheet is not a thing a thumb
 *  can read. So on a phone the page leads with the one figure being approved,
 *  then the deductions, then anything wrong as a card, then the documents and
 *  the flow in one line each, then the sheet as four lines with the full
 *  version one tap away. The decision bar is pinned below by ActionBar.
 *
 *  Server component, `md:hidden` — the laptop gets the full cards. */
export interface PhoneLine { item: string; qty: number; uom: string | null; amt: number }
export interface PhoneDoc { label: string; ok: boolean; note: string | null }

export function PhoneSummary({ figure, figureLabel, claimed, retention, retentionPct, billedBefore, woValue, leftAfter,
  reconciles, overrun, docs, flow, lines, lineCount, sheetHref }: {
  figure: number | null
  figureLabel: string
  claimed: number
  retention: number | null
  retentionPct: number | null
  billedBefore: number | null
  woValue: number | null
  leftAfter: number | null
  reconciles: boolean | null
  overrun: Array<{ item: string; cum: number; ordered: number; uom: string | null }>
  docs: PhoneDoc[]
  flow: string | null
  lines: PhoneLine[]
  lineCount: number
  sheetHref: string
}) {
  const n = (v: number) => formatNumber(v, v % 1 === 0 ? 0 : 2)
  const pct = billedBefore != null && woValue ? Math.round((billedBefore / woValue) * 100) : null
  return (
    <div className="space-y-3 md:hidden">
      <Card className="p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{figureLabel}</p>
        <p className="text-2xl font-extrabold tabular-nums text-gray-900">{figure != null ? formatINR(figure) : '—'}</p>
        {reconciles === true && <p className="mt-1 text-[12px] text-emerald-700">Sheet reconciles to IN4</p>}
        {reconciles === false && <p className="mt-1 text-[12px] text-amber-700">Sheet does not add up to IN4 — check before approving</p>}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          <dt className="text-gray-500">Claimed</dt><dd className="text-right tabular-nums">{formatINR(claimed)}</dd>
          {retention != null && retention > 0 && (
            <><dt className="text-gray-500">Retention{retentionPct != null ? ` ${retentionPct}%` : ''}</dt><dd className="text-right tabular-nums">− {formatINR(retention)}</dd></>
          )}
          {billedBefore != null && (
            <><dt className="text-gray-500">Billed before</dt><dd className="text-right tabular-nums">{formatINRCompact(billedBefore)}{pct != null ? ` (${pct}%)` : ''}</dd></>
          )}
          {leftAfter != null && (
            <><dt className="text-gray-500">Left on order after this</dt><dd className={`text-right tabular-nums ${leftAfter < 0 ? 'font-semibold text-rose-700' : ''}`}>{formatINRCompact(leftAfter)}</dd></>
          )}
        </dl>
      </Card>

      {overrun.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-[12.5px] text-rose-900">
          <b>{overrun.length === 1 ? 'One line' : `${overrun.length} lines`} over the order.</b>{' '}
          {overrun.slice(0, 2).map(o => `${o.item}: ${n(o.cum)} against ${n(o.ordered)} ${o.uom ?? ''}`.trim()).join('; ')}
          {overrun.length > 2 && ` and ${overrun.length - 2} more`}. Needs an IN4 amendment before payment — does not stop the check.
        </div>
      )}

      {docs.length > 0 && (
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Documents</p>
          <ul className="mt-1.5 space-y-1 text-[13px]">
            {docs.map(d => (
              <li key={d.label}>
                <span className={d.ok ? 'text-emerald-700' : 'text-rose-700'}>{d.ok ? '✓' : '✗'}</span>{' '}
                {d.label}{d.note && <span className="text-gray-500"> · {d.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {flow && (
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Flow</p>
          <p className="mt-1.5 text-[12.5px] text-gray-700">{flow}</p>
        </Card>
      )}

      {lines.length > 0 && (
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">This bill · {lineCount} {lineCount === 1 ? 'item' : 'items'}</p>
          <div className="mt-2 divide-y divide-gray-100 text-[12.5px]">
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{l.item} · {n(l.qty)} {l.uom ?? ''}</span>
                <b className="shrink-0 tabular-nums">{formatINRCompact(l.amt)}</b>
              </div>
            ))}
          </div>
          <a href={sheetHref} className="mt-2 inline-block min-h-[32px] text-[12.5px] font-semibold text-indigo-700">
            Open the full sheet{lineCount > lines.length ? ` (${lineCount - lines.length} more lines)` : ''} ›
          </a>
        </Card>
      )}
    </div>
  )
}
