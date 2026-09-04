'use client'
// The Projects lane in the sidebar: the portfolio as a two-level tree (group →
// project) instead of one long list. Each branch remembers whether it is open;
// the branch holding the project on screen opens itself. A project links to its
// Internal Estimate page — the closest thing to a project cockpit today.

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Building2, ChevronDown, ChevronRight, FolderKanban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildProjectTree, countTree, projectIdFromPath, type FlatProject } from '@/lib/project-tree'

const OPEN_KEY = 'srmd_nav_projects_open'
const LANE_KEY = 'srmd_nav_projects_lane'

interface Props {
  projects: FlatProject[]
  mobile?: boolean
  /** Desktop rail collapsed to icons — render one icon that opens the list page. */
  collapsed?: boolean
  onNavigate?: () => void
}

export function ProjectTree({ projects, mobile = false, collapsed = false, onNavigate }: Props) {
  const pathname = usePathname()
  const tree = useMemo(() => buildProjectTree(projects), [projects])
  const activeId = projectIdFromPath(pathname)
  const [laneOpen, setLaneOpen] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try { const raw = localStorage.getItem(OPEN_KEY); if (raw) setOpen(JSON.parse(raw)) } catch {}
    try { const l = localStorage.getItem(LANE_KEY); if (l != null) setLaneOpen(l === '1') } catch {}
  }, [])

  const isOpen = (id: string, hasActive: boolean) => (id in open ? open[id] : hasActive)
  const toggle = (id: string, hasActive: boolean) => {
    const next = { ...open, [id]: !isOpen(id, hasActive) }
    setOpen(next)
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)) } catch {}
  }
  const toggleLane = () => {
    setLaneOpen(v => { try { localStorage.setItem(LANE_KEY, v ? '0' : '1') } catch {}; return !v })
  }

  if (projects.length === 0) return null

  const linkCls = (active: boolean) => cn(
    'flex items-center gap-2 text-sm rounded-lg transition-colors min-h-[36px]',
    mobile ? 'px-3 py-2' : 'px-2 py-1.5',
    active ? 'text-blue-700 bg-blue-50 font-medium' : 'text-gray-700 hover:bg-gray-50',
  )

  if (collapsed && !mobile) {
    return (
      <Link href="/cost-control" title={`Projects (${countTree(tree)})`} className={cn('flex items-center justify-center px-2 py-2.5 my-0.5 rounded-xl text-sm font-medium', pathname.startsWith('/cost-control') ? 'text-blue-700 bg-blue-50' : 'text-gray-700 hover:bg-gray-50')}>
        <FolderKanban className="h-5 w-5" />
      </Link>
    )
  }

  return (
    <div className={mobile ? '' : 'my-0.5'}>
      <button type="button" onClick={toggleLane} aria-expanded={laneOpen}
        className={cn('w-full flex items-center gap-2 text-sm font-semibold rounded-xl transition-colors', mobile ? 'px-4 py-2.5' : 'px-3 py-2', activeId ? 'text-blue-700' : 'text-gray-700 hover:bg-gray-50')}>
        <FolderKanban className={cn('h-5 w-5 flex-shrink-0', activeId ? 'text-blue-600' : 'text-gray-400')} />
        <span className="flex-1 text-left truncate">Projects</span>
        <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{countTree(tree)}</span>
        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-gray-400 transition-transform', laneOpen && 'rotate-180')} />
      </button>
      {laneOpen && (
        <div className={cn('mt-0.5 space-y-0.5 border-l border-gray-200', mobile ? 'ml-6 pl-2' : 'ml-5 pl-2')}>
          {tree.map(g => {
            const hasActive = g.id === activeId || g.children.some(c => c.id === activeId)
            if (g.children.length === 0) {
              return (
                <Link key={g.id} href={`/cost-control/projects/${g.id}`} onClick={onNavigate} className={linkCls(g.id === activeId)} title={g.name}>
                  <Building2 className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="truncate">{g.label}</span>
                </Link>
              )
            }
            const o = isOpen(g.id, hasActive)
            return (
              <div key={g.id}>
                <div className="flex items-center">
                  <button type="button" onClick={() => toggle(g.id, hasActive)} aria-expanded={o} className="p-1.5 -ml-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title={o ? 'Collapse' : 'Expand'}>
                    {o ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <Link href={`/cost-control/projects/${g.id}`} onClick={onNavigate} className={cn(linkCls(g.id === activeId), 'flex-1 min-w-0 font-medium')} title={g.name}>
                    <span className="truncate">{g.label}</span>
                    <span className="ml-auto text-[10px] text-gray-400 tabular-nums">{g.children.length}</span>
                  </Link>
                </div>
                {o && (
                  <div className={cn('space-y-0.5 border-l border-gray-100', mobile ? 'ml-5 pl-2' : 'ml-4 pl-2')}>
                    {g.children.map(c => (
                      <Link key={c.id} href={`/cost-control/projects/${c.id}`} onClick={onNavigate} className={linkCls(c.id === activeId)} title={c.name}>
                        <span className="truncate">{c.code ?? c.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
