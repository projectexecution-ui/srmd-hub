'use client'
// Scrolls a target element (e.g. the sub-skill row a reviewer deep-linked to
// from an approval) into the centre of the viewport once, on mount. Renders
// nothing. Server marks the row with id={targetId} and passes it here.

import { useEffect } from 'react'

export function FocusScroll({ targetId }: { targetId: string }) {
  useEffect(() => {
    const el = document.getElementById(targetId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [targetId])
  return null
}
