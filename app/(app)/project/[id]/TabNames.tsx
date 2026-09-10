'use client'

import { useState } from 'react'
import { Tags, X } from 'lucide-react'
import { NamePencil } from '@/components/names/NamePencil'

export interface TabNameRow {
  key: string
  original: string
  shown: string
  pills: Array<{ key: string; original: string; shown: string }>
}

/**
 * "Rename tabs" — the one place to rename the ribbon's tabs and pills (name
 * layer, Phase 3). A small button in the workspace header for people who may
 * name; it opens a list of every tab with its pills, each with the same pencil
 * used on category rows: type a name, choose Everywhere or only this project.
 * Registry labels stay the identity; a rename is a display row in cthub_names.
 */
export function TabNames({ projectId, projectLabel, rows }: { projectId: string; projectLabel: string; rows: TabNameRow[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] text-gray-600 hover:bg-gray-50 min-h-[36px]"
        title="Rename the tabs and pills of this workspace — everywhere, or only for this project"
      >
        <Tags className="h-4 w-4 text-gray-400" />
        <span className="hidden sm:inline">Rename tabs</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 p-4 pt-16" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Rename tabs and pills</p>
                <p className="text-[12px] text-gray-500">Click a pencil. Each name can apply everywhere or only for {projectLabel}.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[70vh] overflow-auto px-4 py-2 divide-y divide-gray-100">
              {rows.map(t => (
                <div key={t.key} className="py-2.5">
                  <div className="flex items-center text-[13px] font-medium text-gray-900">
                    {t.shown}
                    {t.shown !== t.original && <span className="ml-1.5 text-[11px] font-normal text-gray-400">was {t.original}</span>}
                    <NamePencil kind="tab" nameKey={t.key} shown={t.shown} original={t.original} projectId={projectId} projectLabel={projectLabel} />
                  </div>
                  {t.pills.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-3">
                      {t.pills.map(p => (
                        <span key={p.key} className="inline-flex items-center text-[12px] text-gray-600">
                          {p.shown}
                          {p.shown !== p.original && <span className="ml-1 text-[11px] text-gray-400">was {p.original}</span>}
                          <NamePencil kind="pill" nameKey={p.key} shown={p.shown} original={p.original} projectId={projectId} projectLabel={projectLabel} size="xs" />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
