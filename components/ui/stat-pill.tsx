import * as React from 'react'
import { cn } from '@/lib/utils'

interface StatPillProps {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: React.ReactNode
  className?: string
}

export function StatPill({ label, value, hint, icon, className }: StatPillProps) {
  return (
    <div className={cn('rounded-2xl border border-gray-200 bg-white p-4 shadow-sm', className)}>
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
}
