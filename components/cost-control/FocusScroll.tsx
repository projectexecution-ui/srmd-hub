'use client'
// Scrolls a target element (e.g. the sub-skill row a reviewer deep-linked to
// from an approval) into the centre of the viewport once, on mount. Renders
// nothing. Server marks the row with id={targetId} and passes it here.
//
// The same sub-skill exists twice in the DOM — once in the desktop table, once
// as a phone card — and only one of them is visible at a time. So we take a
// list of candidate ids and scroll to the first one actually being shown;
// scrolling to a `display:none` row does nothing and the phone would just sit
// at the top of the page.

import { useEffect } from 'react'

export function FocusScroll({ targetIds }: { targetIds: string[] }) {
  // Depend on the ids themselves, not the array identity — a fresh array on
  // every render would otherwise re-scroll and fight the user.
  const key = targetIds.join(',')
  useEffect(() => {
    for (const id of key.split(',')) {
      const el = document.getElementById(id)
      // offsetParent is null for anything inside a `hidden`/`display:none`
      // ancestor — exactly how the two layouts hide each other.
      if (el && (el as HTMLElement).offsetParent !== null) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }
  }, [key])
  return null
}
