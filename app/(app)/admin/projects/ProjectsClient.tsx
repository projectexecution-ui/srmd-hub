'use client'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { PeopleData } from '../people/PeopleClient'
import { useCellRunner } from '../people/CardBits'
import { ProjectCards } from '../people/ProjectCards'

export function ProjectsClient({ data, initialProject, noHead }: { data: PeopleData; initialProject?: string; noHead: Array<{ id: string; label: string }> }) {
  const { busy, error, run } = useCellRunner()
  // A "name them" link from the Admin home lands on the first project with no
  // head; the strip below lets you walk the rest without hunting.
  const [pick, setPick] = useState(initialProject)
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {noHead.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-amber-200 bg-amber-50 text-[13px] text-amber-950">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span><b>{noHead.length}</b> {noHead.length === 1 ? 'project has' : 'projects have'} no Project Head:</span>
          {noHead.map(p => <button key={p.id} type="button" onClick={() => setPick(p.id)} className="rounded-full border border-amber-300 bg-white px-2.5 py-0.5 min-h-[28px] hover:bg-amber-100">{p.label}</button>)}
        </div>
      )}
      {error && <p className="px-4 py-2 text-[12px] text-rose-700 border-b border-rose-100 bg-rose-50 inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{error}</p>}
      <div className="p-4">
        <ProjectCards key={pick ?? 'first'} data={data} busy={busy} run={run} initialProject={pick} />
      </div>
    </section>
  )
}
