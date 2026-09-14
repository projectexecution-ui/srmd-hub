import { loadReturnables, loadLists, listsOf } from '@/lib/stores/queries'
import { Section } from '../ui'
import { ReturnClient } from './ReturnClient'

export const dynamic = 'force-dynamic'

/**
 * The mind map's one report under Returnable Items: *"which project has to
 * return what materials to which project"* — and Step 4, the return itself.
 *
 * Vendor debts and project-to-project loans come out of the same register, so
 * they can never be two lists that disagree with each other.
 */
export default async function ReturnablesPage() {
  const [rows, lists] = await Promise.all([loadReturnables(), loadLists()])

  return (
    <Section
      title="Still to come back"
      note="Every returnable that has not been returned — oldest first, because that is what needs chasing"
    >
      <ReturnClient
        rows={rows}
        modes={listsOf(lists, 'delivery_mode').filter(m => m.isActive).map(m => ({ id: m.id, name: m.name }))}
      />
    </Section>
  )
}
