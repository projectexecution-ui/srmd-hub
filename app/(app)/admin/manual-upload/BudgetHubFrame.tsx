'use client'
// The Budget (BPH) upload tool — public/budget-hub.html, server-backed via
// /api/budget-hub/state. The /budget page that used to embed it left in the
// 10 Sep 2026 clean-up; the fallback page embeds it the same way.

import { useEffect, useState } from 'react'
import { Maximize2, FileSpreadsheet, ExternalLink } from 'lucide-react'

export function BudgetHubFrame() {
  const src = '/budget-hub.html'
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { const t = setTimeout(() => setLoaded(true), 100); return () => clearTimeout(t) }, [])
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-teal-600" />
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">Budget (IN4 BPH report)</p>
            <p className="text-[11px] text-gray-500 leading-tight">Upload the weekly ENGG_CONSOLIDATED_SRMDBUDGET Excel. Mapped projects re-sync into Cost Control on save.</p>
          </div>
        </div>
        <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 min-h-[36px] rounded-md hover:bg-gray-100">
          <Maximize2 className="h-3.5 w-3.5" /> Open fullscreen <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <iframe src={src} className={`w-full h-[70vh] border-0 bg-white transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`} title="Budget (IN4 BPH)" />
    </section>
  )
}
