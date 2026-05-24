import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface StatPillProps {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: React.ReactNode
  href?: string
  className?: string
}

export function StatPill({ label, value, hint, icon, href, className }: StatPillProps) {
  const inner = (
    <div className={cn(
      'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm',
      href && 'transition-all hover:shadow-md hover:-translate-y-0.5 hover:border-blue-200 cursor-pointer',
      className,
    )}>
      <div className="flex items-center gap-3">
        {icon && <div className="p-2 rounded-xl bg-blue-50 text-blue-700">{icon}</div>}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-900 truncate">{value}</p>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
        </div>
      </div>
    </div>
  )
  if (href) return <Link href={href} className="block">{inner}</Link>
  return inner
}
