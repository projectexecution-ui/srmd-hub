'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Download, Activity, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReportTab {
  key:      string
  label:    string
  url:      string | null   // signed URL of the report PNG (null = not generated yet)
  filename: string
  content?: ReactNode        // interactive tab (table etc.) instead of an image
}

export default function ReportTabs({ tabs, canEdit }: { tabs: ReportTab[]; canEdit: boolean }) {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const cur = tabs.find(t => t.key === active) ?? tabs[0]

  // Copy the report image to the clipboard so it can be pasted straight into
  // WhatsApp / email. Browsers only accept image/png on the clipboard (not
  // jpg), but a pasted PNG lands as a normal image.
  async function copyImage() {
    if (!cur?.url || copying) return
    const url = cur.url
    setCopying(true)
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('unsupported')
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': fetch(url).then(r => {
            if (!r.ok) throw new Error('fetch failed')
            return r.blob()
          }),
        }),
      ])
      setCopied(true)
      toast.success('Image copied — paste into WhatsApp with Ctrl/Cmd + V')
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.error('Couldn’t copy here — use Download and attach the image instead')
    } finally {
      setCopying(false)
    }
  }

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
        <div className="ml-auto flex items-center gap-2 pl-2">
          {cur?.url && !cur.content && (
            <>
              <Button onClick={copyImage} disabled={copying} variant="outline" size="sm">
                {copied
                  ? <Check className="mr-2 h-4 w-4 text-green-600" />
                  : <Copy className="mr-2 h-4 w-4" />}
                {copying ? 'Copying…' : copied ? 'Copied' : 'Copy image'}
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={cur.url} download={cur.filename}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </a>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Active report */}
      {cur?.content ? (
        cur.content
      ) : cur?.url ? (
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
