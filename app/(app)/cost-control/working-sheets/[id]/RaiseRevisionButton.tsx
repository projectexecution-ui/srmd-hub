// "Raise the next version" on an approved sheet (cc_cumulative_versions).
// Every version — v1 and revisions — now goes through the ONE guarded flow:
// Raise Budget Request (upload). Landing there with this sub-skill's bucket
// downloads the previous version PRE-FILLED as v(N+1); the engineer edits the
// deltas in Excel (take-off formulas = measured, plain numbers = estimate with
// a required reason) and uploads. No free-typing path that can't record a
// take-off. Already-approved money carries forward; the Trustee sees only the
// new ask.

import Link from 'next/link'
import { GitBranch } from 'lucide-react'

export function RaiseRevisionButton({
  projectId, disciplineId, subSkillId,
}: {
  projectId: string
  disciplineId: string
  subSkillId: string | null
}) {
  if (!subSkillId) return null
  const href = `/cost-control/working-sheets/new-quick?project=${projectId}&discipline=${disciplineId}&sub_skill=${subSkillId}`
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-indigo-900">Need to revise this budget?</p>
        <p className="text-xs text-indigo-800/80">
          Drawings changed, quantities grew — raise the next version. You&apos;ll get the previous version
          pre-filled: edit only what changed, add new rows, and upload. Already-approved money carries
          forward; the Trustee sees only what&apos;s new.
        </p>
      </div>
      <Link
        href={href}
        className="inline-flex flex-shrink-0 items-center gap-1.5 h-9 px-3 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
      >
        <GitBranch className="h-4 w-4" /> Raise next version
      </Link>
    </div>
  )
}
