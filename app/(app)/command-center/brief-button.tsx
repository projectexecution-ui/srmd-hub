'use client'
// Daily brief tucked behind a header icon — expand on demand, dismiss to hide.

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'

export function BriefButton({ brief }: { brief: string }) {
  const [open, setOpen] = useState(false)
  if (!brief) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Your brief"
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50 transition"
      >
        <Sparkles className="h-3.5 w-3.5" /> Brief
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 z-30 w-[min(92vw,440px)] bg-white rounded-2xl shadow-xl ring-1 ring-gray-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700/80">Your brief</p>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{brief}</p>
        </div>
      )}
    </div>
  )
}
