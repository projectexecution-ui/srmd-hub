'use client'
import { useState } from 'react'
import { Maximize2, FileSpreadsheet, ExternalLink } from 'lucide-react'

// We intentionally embed the existing SRMD_Budget_Hub.html verbatim in an
// iframe — zero formula changes, zero re-styling. The HTML is served from
// /public/budget-hub.html (and the simpler /budget-simple.html companion).
// "Don't change anything" → preserve the user's app exactly as built.

export default function BudgetPage() {
  const [view, setView] = useState<'hub' | 'simple'>('hub')
  const src = view === 'hub' ? '/budget-hub.html' : '/budget-simple.html'

  function openFullscreen() {
    window.open(src, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-col h-[calc(100vh)] md:h-screen">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold text-gray-900">Budget</span>
          <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5 ml-3">
            <button
              onClick={() => setView('hub')}
              className={
                'px-3 h-7 text-xs font-semibold rounded-md transition-colors ' +
                (view === 'hub' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')
              }
            >
              Master Dashboard + Area Statement
            </button>
            <button
              onClick={() => setView('simple')}
              className={
                'px-3 h-7 text-xs font-semibold rounded-md transition-colors ' +
                (view === 'simple' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')
              }
            >
              Budget vs Actual (single file)
            </button>
          </div>
        </div>
        <button
          onClick={openFullscreen}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 h-7 rounded-md hover:bg-gray-100"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Open fullscreen
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      <iframe
        key={view}
        src={src}
        className="flex-1 w-full border-0 bg-white"
        title={view === 'hub' ? 'SRMD Budget Hub' : 'Budget vs Actual (simple)'}
      />
    </div>
  )
}
