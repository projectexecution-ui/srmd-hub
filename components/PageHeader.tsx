import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BackLink } from '@/components/BackLink'

interface PageHeaderProps {
  title: string
  subtitle?: string
  back?: string
  /** 'href' (default) — Back always goes to the `back` URL (deterministic
   *  "up" navigation). 'history' — Back retraces the user's actual steps
   *  (e.g. stepping through version chain v9→v8→v7 then Back walks them in
   *  reverse), falling back to `back` on a fresh/deep-link load. */
  backMode?: 'href' | 'history'
  children?: React.ReactNode
  className?: string
}

// Mobile-aware: stacks title above actions on phones, side-by-side on
// sm+. Subtitle uses line-clamp-2 instead of truncate so KPI summary
// strings like "12 indents · 87 lines" don't get chopped to nothing on
// narrow screens.
export function PageHeader({ title, subtitle, back, backMode = 'href', children, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        // sm:flex-wrap lets the action cluster drop to its own line when it
        // can't sit beside the title, instead of crushing the title column to
        // zero (which made short titles wrap one-letter-per-line vertically).
        'mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex-1 min-w-[12rem]">
        {back && (
          backMode === 'history'
            ? <BackLink fallbackHref={back} />
            : (
              <Link
                href={back}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </Link>
            )
        )}
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 break-words">{title}</h1>
        {subtitle && (
          <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{subtitle}</p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">
          {children}
        </div>
      )}
    </div>
  )
}
