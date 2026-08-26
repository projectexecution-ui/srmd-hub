'use client'
// Scrolls a target element (e.g. the sub-skill row a reviewer deep-linked to
// from an approval) into view. Renders nothing; the server marks the row with
// id={targetId} and passes it here.
//
// Two things make this harder than one scrollIntoView call:
//
// 1. The same sub-skill exists TWICE in the DOM — once in the desktop table,
//    once as a phone card — and only one is visible at a time. Scrolling to a
//    display:none row silently does nothing, which is why the phone used to
//    just sit at the top of the page. So we take a list of candidate ids and
//    use the first one actually being shown.
//
// 2. The alert strip links back to THIS page with different search params, so
//    a tap is a same-page navigation. Next.js scrolls to top on navigation,
//    and that can land after our effect and undo it. So we check again on the
//    next frames and once more shortly after, and only re-scroll if the target
//    is genuinely out of view — never fighting a scroll the user made.

import { useEffect } from 'react'

/** Is the element inside the visible part of its scrollport (or the viewport)? */
function isOnScreen(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  const scroller = el.closest('.overflow-auto') as HTMLElement | null
  const bounds = scroller
    ? scroller.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight } as DOMRect
  return r.bottom > bounds.top && r.top < bounds.bottom
}

export function FocusScroll({ targetIds }: { targetIds: string[] }) {
  // Depend on the ids themselves, not the array identity — a fresh array on
  // every render would otherwise re-scroll and fight the user.
  const key = targetIds.join(',')

  useEffect(() => {
    let cancelled = false
    const find = (): HTMLElement | null => {
      for (const id of key.split(',')) {
        const el = document.getElementById(id)
        // offsetParent is null inside a `hidden`/`display:none` ancestor —
        // exactly how the desktop table and the phone cards hide each other.
        if (el && el.offsetParent !== null) return el
      }
      return null
    }

    const settle = () => {
      if (cancelled) return
      const el = find()
      if (el && !isOnScreen(el)) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    const el = find()
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Next's scroll-to-top, and any late layout shift, land after this.
    const raf = requestAnimationFrame(() => requestAnimationFrame(settle))
    const t = setTimeout(settle, 300)
    return () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(t) }
  }, [key])

  return null
}
