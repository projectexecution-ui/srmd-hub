'use client'
// The module tiles on the home page. Icon, name, and the live "waiting on
// you" count — nothing else (Aksha, 27 Sep 2026: "clean up with only limited
// required tabs and sections"). The two-line descriptions went: a tile that
// says what needs doing saves attention, one that explains a destination
// costs it. The Admin screens (Users & Roles, Hub settings, Permissions) are
// not tiles either; they are the Admin lane in the pane.

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MODULES, TILE_TONES, type ModuleTile } from '@/lib/modules'
import type { PermissionMap } from '@/lib/types'

interface TileLauncherProps {
  permissions: PermissionMap
  /** Slugs the Portal Owner has hidden from the dashboard. */
  disabledSlugs?: string[]
  /** Optional per-slug label overrides (module_labels). Descriptions are
   *  accepted for compatibility but no longer shown on a tile. */
  moduleLabels?: Record<string, { label: string; description: string }>
  /** Live "waiting on you" count per module slug — from the same approval
   *  inbox that feeds "Needs you now", so a tile and the list never disagree. */
  badges?: Record<string, number>
}

/** Module slugs that never earn a tile: the Admin lane already opens them. */
const NOT_A_TILE = new Set(['admin-users', 'admin-settings', 'admin-permissions'])

export function TileLauncher({ permissions, disabledSlugs = [], moduleLabels = {}, badges = {} }: TileLauncherProps) {
  const disabled = new Set(disabledSlugs)
  const tiles = MODULES
    .filter(m => permissions[m.slug]?.view)
    .filter(m => !disabled.has(m.slug))
    .filter(m => !NOT_A_TILE.has(m.slug))
  if (tiles.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-6 text-center">
        You don&apos;t have access to any modules yet. Ask an admin to grant view access.
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {tiles.map(tile => (
        <Tile key={tile.slug} tile={tile} labelOverride={moduleLabels[tile.slug]?.label} waiting={badges[tile.slug] ?? 0} />
      ))}
    </div>
  )
}

function Tile({ tile, labelOverride, waiting = 0 }: { tile: ModuleTile; labelOverride?: string; waiting?: number }) {
  const tones = TILE_TONES[tile.tone]
  const Icon = tile.icon

  const inner = (
    <div
      className={cn(
        'group relative flex h-full min-h-[96px] flex-col justify-between rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm transition-all',
        'hover:shadow-md hover:-translate-y-0.5 ring-0 hover:ring-4',
        tones.ring,
        tile.comingSoon && 'opacity-70 hover:translate-y-0 hover:shadow-sm cursor-not-allowed',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn('inline-flex h-10 w-10 items-center justify-center rounded-xl', tones.bg, tones.ic)}>
          <Icon className="h-5 w-5" />
        </div>
        {waiting > 0 ? (
          <span
            className="inline-flex items-center rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold px-2 py-0.5 tabular-nums"
            title={`${waiting} waiting on you`}
          >
            {waiting} waiting
          </span>
        ) : tile.external ? (
          <ArrowUpRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
        ) : tile.comingSoon ? (
          <span className="text-[10px] uppercase tracking-wide font-bold text-gray-400">Soon</span>
        ) : null}
      </div>
      <h3 className="mt-3 text-[13px] md:text-sm font-semibold text-gray-900 leading-tight">{labelOverride || tile.label}</h3>
    </div>
  )

  if (tile.comingSoon) return <div>{inner}</div>
  if (tile.external) {
    return <a href={tile.href} target="_blank" rel="noreferrer">{inner}</a>
  }
  return <Link href={tile.href}>{inner}</Link>
}
