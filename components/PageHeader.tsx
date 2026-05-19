import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  back?: string
  children?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, back, children, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-4', className)}>
      <div className="min-w-0">
        {back && (
          <Link
            href={back}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        )}
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-shrink-0">{children}</div>}
    </div>
  )
}
