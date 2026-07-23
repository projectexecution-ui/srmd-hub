'use client'

// Tucks the (optional) AI cross-check panels behind one small right-aligned
// toggle so they don't sit expanded in the middle of the sheet. Collapsed by
// default — reviewers open it on demand; the main flow stays BOQ + approval.

import { useState, type ReactNode } from 'react'
import { Sparkles, ChevronDown } from 'lucide-react'

export function AiToolsDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="AI cross-check — ask a question, split material vs labour, flag rate concerns. Optional; the Excel is the source of truth."
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
          open
            ? 'border-violet-300 bg-violet-100 text-violet-800'
            : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
        }`}
      >
        <Sparkles className="h-3.5 w-3.5" />
        AI tools
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-2 w-full space-y-4">{children}</div>}
    </div>
  )
}
