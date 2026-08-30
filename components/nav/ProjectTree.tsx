'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildProjectTree, countTree, projectIdFromPath, type FlatProject } from '@/lib/revamp/project-tree'

const OPEN_KEY = 'srmd_nav_projects_open'
const BRANCHES_KEY = 'srmd_nav_project_branches'

/**
 * The Projects lane, as a tree.
 *
 * Collapsed by default — Aksha's standing rule that long lists start rolled up
 * (39 projects would otherwise bury every other lane). Opens automatically when
 * you are looking at a project, so the tree always shows where you are without
 * you having to find it.
 */
export function ProjectTree({
  projects, onNavigate,
}: {
  projects: FlatProject[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const tree = useMemo(() => buildProjectTree(projects), [projects])
  const activeId = projectIdFromPath(pathname)

  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<Record<string, boolean>>({})
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let o = false
    let b: Record<string, boolean> = {}
    try { o = localStorage.getItem(OPEN_KEY) === '1' } catch { /* private mode */ }
    try { const raw = localStorage.getItem(BRANCHES_KEY); if (raw) b = JSON.parse(raw) } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(o); setBranches(b); setHydrated(true)
  }, [])

  // Looking at a project? Show it, whatever was remembered.
  const isOnAProject = !!activeId
  const laneOpen = open || isOnAProject

  const parentOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tree) for (const c of t.children) m.set(c.id, t.id)
    return m
  }, [tree])

  const branchOpen = (id: string) => {
    if (branches[id] !== undefined) return branches[id]
    // Auto-open the branch holding the project on screen.
    return activeId === id || parentOf.get(activeId ?? '') === id
  }

  function toggleLane() {
    const next = !laneOpen
    setOpen(next)
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0') } catch { /* ignore */ }
  }

  function toggleBranch(id: string) {
    const next = { ...branches, [id]: !branchOpen(id) }
    setBranches(next)
    try { localStorage.setItem(BRANCHES_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const total = countTree(tree)

  return (
    <div>
      <button
        type="button"
        onClick={toggleLane}
        aria-expanded={laneOpen}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors min-h-[44px]',
          isOnAProject ? 'text-indigo-800 bg-indigo-50/60' : 'text-gray-700 hover:bg-gray-50',
        )}
      >
        <Building2 className="h-5 w-5 flex-shrink-0" />
        <span className="flex-1 text-left">Projects</span>
        <span className="text-[11px] tabular-nums text-gray-400">{total}</span>
        <ChevronRight className={cn('h-4 w-4 text-gray-400 transition-transform', laneOpen && 'rotate-90')} />
      </button>

      {/* Render only once hydrated OR when a project is open, so the server and
          first client paint agree and React does not warn about a mismatch. */}
      {(hydrated || isOnAProject) && laneOpen && (
        <div className="pb-1">
          {tree.map(p => {
            const hasKids = p.children.length > 0
            const isActive = activeId === p.id
            const bOpen = branchOpen(p.id)

            return (
              <div key={p.id}>
                <div className="flex items-stretch">
                  {hasKids ? (
                    <button
                      type="button"
                      onClick={() => toggleBranch(p.id)}
                      aria-label={bOpen ? `Collapse ${p.name}` : `Expand ${p.name}`}
                      className="pl-6 pr-1 flex items-center text-gray-400 hover:text-gray-700"
                    >
                      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', bOpen && 'rotate-90')} />
                    </button>
                  ) : (
                    <span className="pl-6 pr-1 w-[1.375rem]" aria-hidden />
                  )}
                  <Link
                    href={`/project/${p.id}`}
                    onClick={onNavigate}
                    className={cn(
                      'flex-1 min-w-0 py-1.5 pr-3 text-[13px] truncate min-h-[36px] flex items-center',
                      isActive ? 'font-semibold text-indigo-800' : 'text-gray-600 hover:text-gray-900',
                    )}
                    title={p.name}
                  >
                    {p.code && <span className="font-mono text-[10px] text-gray-400 mr-1.5 flex-shrink-0">{p.code}</span>}
                    <span className="truncate">{p.name}</span>
                  </Link>
                </div>

                {hasKids && bOpen && p.children.map(c => (
                  <Link
                    key={c.id}
                    href={`/project/${c.id}`}
                    onClick={onNavigate}
                    className={cn(
                      'flex items-center pl-12 pr-3 py-1.5 text-[13px] truncate min-h-[36px]',
                      activeId === c.id ? 'font-semibold text-indigo-800' : 'text-gray-500 hover:text-gray-900',
                    )}
                    title={c.name}
                  >
                    {c.code && <span className="font-mono text-[10px] text-gray-400 mr-1.5 flex-shrink-0">{c.code}</span>}
                    <span className="truncate">{c.name}</span>
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
