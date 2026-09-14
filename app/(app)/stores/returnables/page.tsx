import Link from 'next/link'
import { PauseCircle } from 'lucide-react'
import { loadReturnables, loadLists, listsOf } from '@/lib/stores/queries'
import { RETURNABLES_ON } from '@/lib/stores/core'
import { Section } from '../ui'
import { ReturnClient } from './ReturnClient'

export const dynamic = 'force-dynamic'

/**
 * The mind map's Returnable Items branch — "which project has to return what
 * materials to which project" — and Step 4, the return itself.
 *
 * SWITCHED OFF since 14 Sep 2026 (RETURNABLES_ON in lib/stores/core.ts). The
 * page stays reachable and says so, rather than 404-ing: a bookmark that
 * suddenly dies reads as a fault, and somebody would spend an afternoon on it.
 */
export default async function ReturnablesPage() {
  if (!RETURNABLES_ON) return <SwitchedOff />

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

function SwitchedOff() {
  return (
    <div className="max-w-xl mx-auto text-center py-12 px-4">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 border border-gray-200 mb-3">
        <PauseCircle className="h-5 w-5 text-gray-500" />
      </span>
      <h2 className="text-lg font-bold text-gray-900">Returnables are switched off</h2>
      <p className="text-[13px] text-gray-600 mt-2">
        Aksha turned this off on 14 September — it is not needed at the moment. The gate, the store and the
        registers all work exactly as before; only this branch is hidden.
      </p>
      <p className="text-[12.5px] text-gray-500 mt-3">
        <b>Nothing has been deleted.</b> Everything already marked returnable, and every return already
        recorded, is still in the register. Turning it back on shows the true position rather than an empty
        list — it is one line in <span className="font-mono">lib/stores/core.ts</span>.
      </p>
      <Link
        href="/stores"
        className="mt-6 inline-flex items-center rounded-lg bg-indigo-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-800 min-h-[44px]"
      >
        Back to the store
      </Link>
    </div>
  )
}
