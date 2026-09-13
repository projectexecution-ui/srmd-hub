import { loadReturnables } from '@/lib/stores/queries'
import { fmtQty } from '@/lib/stores/core'
import { formatDate } from '@/lib/utils'
import { Section, Empty, Scroller, th, td, tdNum } from '../ui'

export const dynamic = 'force-dynamic'

/**
 * The mind map's one report under Returnable Items: *"which project has to
 * return what materials to which project."*
 *
 * Vendor debts and project-to-project loans come out of the same register, so
 * they can never be two lists that disagree with each other.
 */
export default async function ReturnablesPage() {
  const rows = await loadReturnables()

  return (
    <Section
      title="Still to come back"
      note="Every returnable that has not been returned — oldest first, because that is what needs chasing"
    >
      {rows.length === 0 ? (
        <Empty
          title="Nothing is out on loan"
          hint="A line becomes a debt the moment it is ticked “must come back” — on a vendor delivery, or on material issued from the store."
        />
      ) : (
        <Scroller min={800}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Held by</th>
                <th className={th}>Owed to</th>
                <th className={`${th} text-right`}>Out</th>
                <th className={`${th} text-right`}>Back</th>
                <th className={`${th} text-right`}>Still out</th>
                <th className={th}>Since</th>
                <th className={th}>Entry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.entryId}-${r.itemId}`}>
                  <td className={td}>{r.itemName}</td>
                  <td className={td}>{r.heldBy}</td>
                  <td className={td}>{r.owedTo}</td>
                  <td className={tdNum}>{fmtQty(r.qty)} {r.unit}</td>
                  <td className={tdNum}>{r.returned > 0 ? fmtQty(r.returned) : '—'}</td>
                  <td className={`${tdNum} font-bold ${r.days > 30 ? 'text-rose-700' : 'text-amber-800'}`}>
                    {fmtQty(r.outstanding)}
                  </td>
                  <td className={td}>
                    {formatDate(r.since)}
                    <span className={`block text-[11px] ${r.days > 30 ? 'text-rose-600 font-semibold' : 'text-gray-400'}`}>
                      {r.days} day{r.days === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className={`${td} font-mono text-[12px] text-gray-500`}>{r.entryNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      )}

      <p className="text-[12px] text-gray-500">
        Recording the return itself is the next step — the debt is tracked now, clearing it still has to be
        built. Until then a returned item stays on this list, which is the safe direction to be wrong in.
      </p>
    </Section>
  )
}
