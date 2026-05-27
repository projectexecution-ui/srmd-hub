import type { MatrixData } from '@/lib/jmr/matrix'
import { COLUMN_PALETTE } from '@/lib/jmr/matrix'
import { formatNumberIN, formatINR, formatDateIN } from '@/lib/jmr/format'

export function MatrixTable({ data }: { data: MatrixData }) {
  const equipmentRows = data.rows.filter(r => r.category === 'equipment')
  const manpowerRows = data.rows.filter(r => r.category === 'manpower')
  // Items that appear in more than one row (different rate bands) — for
  // these we always render the period meta-line so the user knows which
  // window each row covers. Single-band items don't need it (the page
  // header already shows the overall date range).
  const itemRowCounts = new Map<string, number>()
  for (const r of data.rows) itemRowCounts.set(r.item_id, (itemRowCounts.get(r.item_id) ?? 0) + 1)

  // Include all sub-projects from the filter; also include "unassigned" if any rows have it.
  const subProjects = [...data.subProjects]
  const hasUnassigned = data.rows.some(r => r.cells['unassigned'])
  if (hasUnassigned) {
    subProjects.push({ id: 'unassigned', name: 'Unassigned', code: null })
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse min-w-[1200px] w-full">
        <thead>
          <tr>
            <th rowSpan={2} className="px-2 py-2 border border-gray-300 bg-gray-50 text-left font-bold sticky left-0 z-10">Sr.</th>
            <th rowSpan={2} className="px-2 py-2 border border-gray-300 bg-amber-100 text-left font-bold min-w-[200px]">Item Description</th>
            <th rowSpan={2} className="px-2 py-2 border border-gray-300 bg-gray-50 font-bold">Unit</th>
            <th rowSpan={2} className="px-2 py-2 border border-gray-300 bg-gray-50 text-right font-bold">Rate</th>
            {subProjects.map((sp, i) => {
              const p = COLUMN_PALETTE[i % COLUMN_PALETTE.length]!
              return (
                <th key={sp.id} colSpan={2} className={`px-2 py-1 border border-gray-300 ${p.bg} ${p.text} text-center font-bold`}>
                  {sp.code || sp.name}
                </th>
              )
            })}
            <th rowSpan={2} className="px-2 py-2 border border-gray-300 bg-amber-200 text-right font-bold">Total</th>
          </tr>
          <tr>
            {subProjects.map((sp, i) => {
              const p = COLUMN_PALETTE[i % COLUMN_PALETTE.length]!
              return (
                <>
                  <th key={`${sp.id}-q`} className={`px-2 py-1 border border-gray-300 ${p.bg} ${p.text} text-right font-semibold`}>Qty</th>
                  <th key={`${sp.id}-a`} className={`px-2 py-1 border border-gray-300 ${p.bg} ${p.text} text-right font-semibold`}>Amount</th>
                </>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {equipmentRows.length > 0 && (
            <SectionRow label="EQUIPMENT SUPPLY" colSpan={4 + subProjects.length * 2 + 1} />
          )}
          {equipmentRows.map((r, idx) => (
            // Key is (item_id, rate) — same item at two different rates
            // produces two separate rows (the A + B split).
            <ItemRow
              key={`${r.item_id}::${r.rate}`}
              row={r}
              idx={idx + 1}
              subProjects={subProjects}
              showPeriod={(itemRowCounts.get(r.item_id) ?? 0) > 1}
            />
          ))}
          {manpowerRows.length > 0 && (
            <SectionRow label="MANPOWER (FOR 8 HOURS) SUPPLY" colSpan={4 + subProjects.length * 2 + 1} />
          )}
          {manpowerRows.map((r, idx) => (
            <ItemRow
              key={`${r.item_id}::${r.rate}`}
              row={r}
              idx={equipmentRows.length + idx + 1}
              subProjects={subProjects}
              showPeriod={(itemRowCounts.get(r.item_id) ?? 0) > 1}
            />
          ))}
          <tr className="font-bold bg-gray-100">
            <td colSpan={4} className="px-2 py-2 border border-gray-300 text-right uppercase">Sub-total</td>
            {subProjects.map((sp, i) => (
              <>
                <td key={`${sp.id}-stq`} className="px-2 py-2 border border-gray-300"></td>
                <td key={`${sp.id}-sta`} className="px-2 py-2 border border-gray-300 text-right">
                  {formatNumberIN(data.subTotalsBySubProject[sp.id] ?? 0)}
                </td>
              </>
            ))}
            <td className="px-2 py-2 border border-gray-300 text-right">{formatNumberIN(data.subTotalAll)}</td>
          </tr>
          <tr className="bg-gray-50">
            <td colSpan={4 + subProjects.length * 2} className="px-2 py-2 border border-gray-300 text-right font-semibold uppercase">
              GST {data.gstRate}%
            </td>
            <td className="px-2 py-2 border border-gray-300 text-right font-semibold">{formatNumberIN(data.gstAmount)}</td>
          </tr>
          <tr className="font-bold bg-amber-200 text-amber-950">
            <td colSpan={4 + subProjects.length * 2} className="px-2 py-2 border border-gray-300 text-right uppercase">Grand Total</td>
            <td className="px-2 py-2 border border-gray-300 text-right">{formatINR(data.grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function SectionRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr className="bg-slate-200 font-bold">
      <td colSpan={colSpan} className="px-2 py-1.5 border border-gray-300 uppercase tracking-wide text-slate-800">
        {label}
      </td>
    </tr>
  )
}

function ItemRow({ row, idx, subProjects, showPeriod }: {
  row: import('@/lib/jmr/matrix').MatrixRow
  idx: number
  subProjects: { id: string; name: string; code: string | null }[]
  showPeriod: boolean
}) {
  const period = showPeriod && row.effectiveFrom && row.effectiveTo
    ? (row.effectiveFrom === row.effectiveTo
        ? formatDateIN(row.effectiveFrom)
        : `${formatDateIN(row.effectiveFrom)} → ${formatDateIN(row.effectiveTo)}`)
    : null
  return (
    <tr className="hover:bg-blue-50/40">
      <td className="px-2 py-1.5 border border-gray-300 text-gray-500 sticky left-0 bg-white">{idx}</td>
      <td className="px-2 py-1.5 border border-gray-300">
        <div>{row.item_name}</div>
        {period && (
          <div className="text-[10px] text-gray-500 mt-0.5">{period}</div>
        )}
      </td>
      <td className="px-2 py-1.5 border border-gray-300 text-center text-gray-700">{row.unit}</td>
      <td className="px-2 py-1.5 border border-gray-300 text-right font-mono">{row.rate != null ? formatNumberIN(row.rate) : '—'}</td>
      {subProjects.map((sp, i) => {
        const p = COLUMN_PALETTE[i % COLUMN_PALETTE.length]!
        const cell = row.cells[sp.id]
        return (
          <>
            <td key={`${sp.id}-q`} className={`px-2 py-1.5 border border-gray-300 text-right ${cell ? p.bg : ''}`}>
              {cell ? formatNumberIN(cell.qty, cell.qty % 1 === 0 ? 0 : 2) : '0'}
            </td>
            <td key={`${sp.id}-a`} className={`px-2 py-1.5 border border-gray-300 text-right ${cell ? p.bg : ''}`}>
              {cell ? formatNumberIN(cell.amount) : '0'}
            </td>
          </>
        )
      })}
      <td className="px-2 py-1.5 border border-gray-300 text-right font-semibold bg-amber-50">
        {formatNumberIN(row.total.amount)}
      </td>
    </tr>
  )
}
