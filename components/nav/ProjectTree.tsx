'use client'
// The Projects lane in the sidebar: the portfolio as a two-level tree (group →
// project) instead of one long list. Each branch remembers whether it is open;
// the branch holding the project on screen opens itself. A project links to its
// Internal Estimate page — the closest thing to a project cockpit today.

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Building2, ChevronDown, ChevronRight, FolderKanban, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildProjectTree, countTree, projectIdFromPath, type FlatProject } from '@/lib/project-tree'
import { projectHref } from '@/lib/revamp/tabs'
import { isRevampNow } from '@/lib/revamp/live'
import { readOpenMap, writeOpenMap, readFlag, writeFlag } from '@/lib/nav-prefs'
import { VERIFY_PILL } from '@/lib/revamp/verify-pill'

const OPEN_KEY = 'srmd_nav_projects_open'
const LANE_KEY = 'srmd_nav_projects_lane'
const FILTER_KEY = 'srmd_nav_projects_filter'

interface Props {
  projects: FlatProject[]
  /** project id → approvals waiting on THIS person, already rolled up so a
   *  collapsed group carries its children's queue. Amber, because it is work
   *  on your desk rather than a count of what exists. */
  approvals?: Record<string, number>
  /** project id → documents sitting at Verify in IN4, rolled up the same way.
   *  Teal, not amber: this is not on your CT Hub desk, it is parked in IN4
   *  waiting to be verified there. */
  verify?: Record<string, number>
  mobile?: boolean
  /** Desktop rail collapsed to icons — render one icon that opens the list page. */
  collapsed?: boolean
  onNavigate?: () => void
  /** Where a project click lands: the workspace (revamp) or the old Internal Estimate page (CT Hub V1). */
  revamp?: boolean
}

export function ProjectTree({ projects, approvals = {}, verify = {}, mobile = false, collapsed = false, onNavigate, revamp = isRevampNow() }: Props) {
  const pathname = usePathname()
  const tree = useMemo(() => buildProjectTree(projects), [projects])
  const activeId = projectIdFromPath(pathname)
  const [laneOpen, setLaneOpen] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // Type two letters and the tree collapses to the matches (UX item 2 —
  // 33 projects on a phone is a long scroll). Remembered for the session.
  const [q, setQ] = useState('')
  useEffect(() => { try { setQ(sessionStorage.getItem(FILTER_KEY) ?? '') } catch { /* private mode */ } }, [])
  const setFilter = (v: string) => { setQ(v); try { sessionStorage.setItem(FILTER_KEY, v) } catch { /* ignore */ } }
  const needle = q.trim().toLowerCase()
  const hit = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle)
  const shown = useMemo(() => {
    if (!needle) return tree
    return tree
      .map(g => {
        const kids = g.children.filter(c => hit(c.name) || hit(c.code) || hit(c.label))
        const self = hit(g.name) || hit(g.label) || hit(g.code)
        return self || kids.length ? { ...g, children: self ? g.children : kids } : null
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
  }, [tree, needle])

  useEffect(() => {
    // Validated, not just parsed: this key held a plain "1" in the revamp
    // trial, and JSON.parse turns that into the NUMBER 1 — after which
    // `id in open` throws and takes the whole app layout down with it.
    setOpen(readOpenMap(OPEN_KEY))
    const lane = readFlag(LANE_KEY)
    if (lane !== null) setLaneOpen(lane)
  }, [])

  const isOpen = (id: string, hasActive: boolean) => (id in open ? open[id] : hasActive)
  const toggle = (id: string, hasActive: boolean) => {
    const next = { ...open, [id]: !isOpen(id, hasActive) }
    setOpen(next)
    writeOpenMap(OPEN_KEY, next)
  }
  const toggleLane = () => {
    setLaneOpen(v => { writeFlag(LANE_KEY, !v); return !v })
  }

  // Every project's own queue, for the lane header.
  const laneVerify = Object.values(verify).reduce((t, n) => t + n, 0)
  const laneWaiting = Object.values(approvals).length
    ? projects.reduce((t, p) => t + (p.parentId ? (approvals[p.id] ?? 0) : 0), 0)
      + projects.reduce((t, p) => t + (p.parentId ? 0 : (approvals[p.id] ?? 0)), 0)
    : 0

  if (projects.length === 0) return null

  const linkCls = (active: boolean) => cn(
    'flex items-center gap-2 text-sm rounded-lg transition-colors min-h-[36px]',
    mobile ? 'px-3 py-2' : 'px-2 py-1.5',
    active ? 'text-blue-700 bg-blue-50 font-medium' : 'text-gray-700 hover:bg-gray-50',
  )

  if (collapsed && !mobile) {
    return (
      <Link href="/cost-control" title={`Projects (${countTree(tree)})`} className={cn('flex items-center justify-center px-2 py-2.5 my-0.5 rounded-xl text-sm font-medium', (pathname.startsWith('/cost-control') || pathname.startsWith('/project/')) ? 'text-blue-700 bg-blue-50' : 'text-gray-700 hover:bg-gray-50')}>
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
        {laneWaiting > 0 && <WaitPill n={laneWaiting} />}
        {laneVerify > 0 && <VerifyPill n={laneVerify} />}
        <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{countTree(tree)}</span>
        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-gray-400 transition-transform', laneOpen && 'rotate-180')} />
      </button>
      {laneOpen && (
        <div className={cn('mt-0.5 space-y-0.5 border-l border-gray-200', mobile ? 'ml-6 pl-2' : 'ml-5 pl-2')}>
          {tree.length > 6 && (
            <div className={cn('relative', mobile ? 'pr-3 pb-1' : 'pr-2 pb-1')}>
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                type="search"
                value={q}
                onChange={e => setFilter(e.target.value)}
                placeholder="Find a project"
                aria-label="Find a project"
                className={cn('w-full rounded-lg border border-gray-200 bg-white pl-7 pr-2 text-[12px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-200', mobile ? 'min-h-[44px]' : 'h-8')}
              />
            </div>
          )}
          {needle && shown.length === 0 && (
            <p className="px-2 py-1.5 text-[12px] text-gray-500">No project matches “{q.trim()}”.</p>
          )}
          {shown.map(g => {
            const hasActive = g.id === activeId || g.children.some(c => c.id === activeId)
            if (g.children.length === 0) {
              return (
                <Link key={g.id} href={projectHref(g.id, revamp)} onClick={onNavigate} className={linkCls(g.id === activeId)} title={g.name}>
                  <Building2 className="h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="truncate">{g.label}</span>
                  {(approvals[g.id] ?? 0) > 0 && <WaitPill n={approvals[g.id]} className="ml-auto" />}
                  {(verify[g.id] ?? 0) > 0 && <VerifyPill n={verify[g.id]} className={(approvals[g.id] ?? 0) > 0 ? 'ml-1' : 'ml-auto'} />}
                </Link>
              )
            }
            // While filtering, every surviving group is open — that is what the
            // filter is for. Otherwise the remembered state.
            const o = needle ? true : isOpen(g.id, hasActive)
            return (
              <div key={g.id}>
                <div className="flex items-center">
                  <button type="button" onClick={() => toggle(g.id, hasActive)} aria-expanded={o} className="p-1.5 -ml-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100" title={o ? 'Collapse' : 'Expand'}>
                    {o ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <Link href={projectHref(g.id, revamp)} onClick={onNavigate} className={cn(linkCls(g.id === activeId), 'flex-1 min-w-0 font-medium')} title={g.name}>
                    <span className="truncate">{g.label}</span>
                    {(approvals[g.id] ?? 0) > 0 && <WaitPill n={approvals[g.id]} className="ml-auto" />}
                    {(verify[g.id] ?? 0) > 0 && <VerifyPill n={verify[g.id]} className={(approvals[g.id] ?? 0) > 0 ? 'ml-1' : 'ml-auto'} />}
                    <span className={cn('text-[10px] text-gray-400 tabular-nums', ((approvals[g.id] ?? 0) > 0 || (verify[g.id] ?? 0) > 0) ? 'ml-1.5' : 'ml-auto')}>{g.children.length}</span>
                  </Link>
                </div>
                {o && (
                  <div className={cn('space-y-0.5 border-l border-gray-100', mobile ? 'ml-5 pl-2' : 'ml-4 pl-2')}>
                    {g.children.map(c => (
                      <Link key={c.id} href={projectHref(c.id, revamp)} onClick={onNavigate} className={linkCls(c.id === activeId)} title={c.name}>
                        <span className="truncate">{c.code ?? c.name}</span>
                        {(approvals[c.id] ?? 0) > 0 && <WaitPill n={approvals[c.id]} className="ml-auto" />}
                        {(verify[c.id] ?? 0) > 0 && <VerifyPill n={verify[c.id]} className={(approvals[c.id] ?? 0) > 0 ? 'ml-1' : 'ml-auto'} />}
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

/** Sitting at Verify in IN4 — somebody else's screen, not this one. Teal so
 *  it never reads as the amber "yours to approve". */
function VerifyPill({ n, className }: { n: number; className?: string }) {
  return (
    <span
      title={`${n} document${n === 1 ? '' : 's'} at Verify in IN4`}
      className={cn(
        'inline-flex items-center justify-center rounded-full',
        VERIFY_PILL,
        'text-[10px] font-bold tabular-nums min-w-[17px] h-[17px] px-1 flex-shrink-0',
        className,
      )}
    >
      {n}
    </span>
  )
}

/** The yellow count: approvals waiting on the person reading it. Amber and not
 *  grey on purpose — grey is "how many exist", amber is "this is yours". */
function WaitPill({ n, className }: { n: number; className?: string }) {
  return (
    <span
      title={`${n} approval${n === 1 ? '' : 's'} waiting on you`}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800',
        'border border-amber-200 text-[10px] font-bold tabular-nums min-w-[17px] h-[17px] px-1 flex-shrink-0',
        className,
      )}
    >
      {n}
    </span>
  )
}
