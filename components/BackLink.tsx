'use client'
// "Back" that retraces the user's actual steps instead of always jumping to a
// fixed parent. On a working-sheet detail page you often step through the
// version chain (v9 → v8 → v7 …) with the version bar arrows; the header Back
// should then walk back through THOSE versions in sequence, not skip straight
// out to the list.
//
// If there is in-app history to go back to we call router.back(); otherwise
// (fresh tab, deep link, first page after login) we fall back to the fixed
// href so Back is never a dead end. Rendered as a real <a href> so it stays
// right-clickable and works before hydration.

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

export function BackLink({ fallbackHref, label = 'Back', className }: {
  fallbackHref: string
  label?: string
  className?: string
}) {
  const router = useRouter()

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Let modified clicks (new tab, etc.) use the plain href.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    // history.length > 1 means we arrived here by navigating within the app,
    // so the previous entry is the page (or prior version) to return to.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  return (
    <a
      href={fallbackHref}
      onClick={onClick}
      className={className ?? 'inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1'}
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {label}
    </a>
  )
}
