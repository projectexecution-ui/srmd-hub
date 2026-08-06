// Shared item thumbnail. Shows the item photo when present, otherwise a clean
// deterministic letter-monogram (coloured by category) — never a broken-image
// icon. The parent supplies the sized, rounded, overflow-hidden container.

import Image from 'next/image'
import { cn } from '@/lib/utils'

export interface ThumbItem {
  name: string
  code?: string | null
  category?: string | null
  image_url: string | null
}

// Deterministic soft colour per category so no-image cards look intentional.
const MONO = [
  'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700', 'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700',
  'bg-lime-100 text-lime-700', 'bg-orange-100 text-orange-700', 'bg-teal-100 text-teal-700',
]
function monoClass(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return MONO[h % MONO.length]
}
function initials(name: string) {
  const w = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || '#'
}

export function ItemThumb({ item, size = 40, className }: { item: ThumbItem; size?: number; className?: string }) {
  if (item.image_url) {
    return (
      <Image
        src={item.image_url}
        alt={item.name}
        width={size}
        height={size}
        className={cn('object-cover h-full w-full', className)}
        unoptimized
      />
    )
  }
  return (
    <div className={cn('h-full w-full flex items-center justify-center font-bold', monoClass(item.category ?? item.code ?? item.name ?? '#'), className)}>
      <span style={{ fontSize: Math.max(11, size / 3.2) }}>{initials(item.name)}</span>
    </div>
  )
}
