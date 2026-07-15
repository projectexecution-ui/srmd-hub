'use client'
// Engineer's "assigned to me" budget-working list, minimised to a purple
// icon on the header. Opens on hover (peek) or click (pin); auto-collapses
// when neither hovered nor pinned.

import { useState } from 'react'
import Link from 'next/link'
import { ClipboardList, CheckCircle2, ArrowRight } from 'lucide-react'

export type AssignedItem = {
  projectId: string
  subSkillId: string
  disciplineId: string | null
  subCode: string | null
  subName: string | null
  projectCode: string | null
  projectName: string | null
  done: boolean
}

export function AssignedToMePopover({ items, canWrite, pendingCount }: {
  items: AssignedItem[]
  canWrite: boolean
  pendingCount: number
}) {
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const show = hover || pinned

  if (items.length === 0) return null

  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={() => setPinned(p => !p)}
        className={`relative inline-flex items-center justify-center h-9 w-9 rounded-xl shadow-sm transition-colors ${
          show ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }`}
        title="My budget working — assigned to me"
        aria-label="My budget working — assigned to me"
        aria-expanded={show}
      >
        <ClipboardList className="h-4 w-4" />
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
            {pendingCount}
          </span>
        )}
      </button>

      {show && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="sticky top-0 px-4 py-2.5 border-b border-indigo-100 bg-indigo-50/70 flex items-center justify-between">
            <span className="text-sm font-bold text-indigo-900 inline-flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4" /> Assigned to me
            </span>
            <span className="text-[11px] font-semibold text-indigo-700">
              {pendingCount > 0 ? `${pendingCount} to start` : 'all started'}
            </span>
          </div>
          <ul className="divide-y divide-gray-100">
            {items.map(a => (
              <li key={`${a.projectId}::${a.subSkillId}`} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">
                    <span className="font-mono text-[11px] text-gray-400 mr-1.5">{a.subCode}</span>
                    {a.subName ?? 'Sub-skill'}
                  </p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {a.projectCode ? `${a.projectCode}${a.projectName ? ` · ${a.projectName}` : ''}` : 'Project'}
                  </p>
                </div>
                {a.done ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 whitespace-nowrap">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sheet raised
                  </span>
                ) : canWrite ? (
                  <Link
                    href={`/cost-control/working-sheets/new-quick?project=${a.projectId}${a.disciplineId ? `&discipline=${a.disciplineId}` : ''}&sub_skill=${a.subSkillId}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
                  >
                    Start sheet <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-[11px] text-amber-700 font-semibold whitespace-nowrap">Not started</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
