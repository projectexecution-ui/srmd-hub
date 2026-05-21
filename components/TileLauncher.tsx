'use client'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MODULES, TILE_TONES, type ModuleTile } from '@/lib/modules'
import type { PermissionMap } from '@/lib/types'

interface TileLauncherProps {
  permissions: PermissionMap
}

export function TileLauncher({ permissions }: TileLauncherProps) {
  const tiles = MODULES.filter(m => permissions[m.slug]?.view)
  if (tiles.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        You don&apos;t have access to any modules yet. Ask an admin to grant view access.
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
      {tiles.map(tile => <Tile key={tile.slug} tile={tile} />)}
    </div>
  )
}

function Tile({ tile }: { tile: ModuleTile }) {
  const tones = TILE_TONES[tile.tone]
  const Icon = tile.icon

  const inner = (
    <div
      className={cn(
        'group relative h-full rounded-2xl border border-gray-200 bg-white p-4 md:p-5 shadow-sm transition-all',
        'hover:shadow-md hover:-translate-y-0.5 ring-0 hover:ring-4',
        tones.ring,
        tile.comingSoon && 'opacity-70 hover:translate-y-0 hover:shadow-sm cursor-not-allowed'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl', tones.bg, tones.ic)}>
          <Icon className="h-5 w-5" />
        </div>
        {tile.external && (
          <ArrowUpRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
        )}
      </div>
      <h3 className="text-sm md:text-base font-semibold text-gray-900 leading-tight">{tile.label}</h3>
      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tile.description}</p>
      {tile.comingSoon && (
        <div className="absolute top-3 right-3 text-[10px] uppercase tracking-wide font-bold text-gray-400">
          Soon
        </div>
      )}
    </div>
  )

  if (tile.comingSoon) return <div>{inner}</div>
  if (tile.external) {
    return <a href={tile.href} target="_blank" rel="noreferrer">{inner}</a>
  }
  return <Link href={tile.href}>{inner}</Link>
}
