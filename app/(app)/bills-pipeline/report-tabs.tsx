'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Download, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReportTab {
  key:      string
  label:    string
  url:      string | null   // signed URL of the report PNG (null = not generated yet)
  filename: string
}

export default function ReportTabs({ tabs, canEdit }: { tabs: ReportTab[]; canEdit: boolean }) {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  const cur = tabs.find(t => t.key === active) ?? tabs[0]

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              active === t.key
                ? 'border-indigo-600 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto pl-2">
          {cur?.url && (
            <Button asChild variant="outline" size="sm">
              <a href={cur.url} download={cur.filename}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Active report */}
      {cur?.url ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cur.url} alt={cur.label} className="block h-auto w-full" />
        </div>
      ) : (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="Report not generated yet"
          description={
            canEdit
              ? 'Click "Refresh" above to generate all reports from the latest Zoho data.'
              : 'This report will appear after the next weekly run.'
          }
        />
      )}
    </div>
  )
}
