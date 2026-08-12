'use client'

// Two-view procurement tracker. Aksha's actual job here is to know:
//   1. Which materials have I ordered but not yet received?  → Pending Receipts
//   2. Which materials haven't been PO'd by my purchase team? → Needs PO
// Everything else is noise for that workflow, so we hide it. The richer
// dashboard widgets (KPI grid, funnel band, discipline chart, top
// vendors scorecard, full indent table) still exist in the codebase
// but no longer ship in the default UI.

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import type { ParseResult, LineRecord, SnapshotDiff, ProjectSummary } from '@/lib/procurement'
import { mergeReports } from '@/lib/procurement/merge'
import { formatSavedAt } from '@/lib/procurement/storage'
import { PendingReceiptsView } from '@/components/procurement-tracker/PendingReceiptsView'
import { IndentsNeedingPoView } from '@/components/procurement-tracker/IndentsNeedingPoView'
import { CompletedView } from '@/components/procurement-tracker/CompletedView'
import { DiffBanner } from '@/components/procurement-tracker/DiffBanner'
import { ProjectFilterStrip } from '@/components/procurement-tracker/ProjectFilterStrip'
import { UniversalSearch } from '@/components/procurement-tracker/UniversalSearch'
import { DataHealth } from '@/components/procurement-tracker/DataHealth'
import { buildTrackerSummaryPdf } from '@/lib/procurement/pdf'
import type { ChaseNote } from '@/lib/procurement/chase-notes'
import type { DroppedLine } from '@/lib/procurement/dropped'
import { dropKey } from '@/lib/procurement/dropped'
import { DroppedItemsPanel } from '@/components/procurement-tracker/DroppedItemsPanel'
import Link from 'next/link'
import { Upload, FileSpreadsheet, Loader2, PackageX, ClipboardList, EyeOff, CheckCircle2, Clock, FileText } from 'lucide-react'

type AnalyseResponse = ParseResult & {
  success: boolean
  fileName: string
  error?: string
  /** Wire-format diff: arrays in JSON, converted to Sets at receive-time. */
  diff?: {
    prevSavedAt: string
    prevFileName: string
    prevUpdatedByName?: string | null
    changedIndents: string[]
    newLineIds: string[]
    changedLineIds: string[]
    newlyGrnDone: number
    newlyInProgress: number
    newlyOverdue: number
    newlyComplete: number
  } | null
}

function hydrateDiff(wire: NonNullable<AnalyseResponse['diff']>): SnapshotDiff {
  return {
    prevSavedAt: wire.prevSavedAt,
    prevFileName: wire.prevFileName,
    changedIndents: new Set(wire.changedIndents),
    newLineIds: new Set(wire.newLineIds),
    changedLineIds: new Set(wire.changedLineIds),
    newlyGrnDone: wire.newlyGrnDone,
    newlyInProgress: wire.newlyInProgress,
    newlyOverdue: wire.newlyOverdue,
    newlyComplete: wire.newlyComplete,
  }
}

type View = 'pending' | 'needs-po' | 'completed'

// One uploaded IN4 report (parsed projects + metadata), as returned per slot
// by /api/procurement-tracker/state.
type ReportSlot = {
  projects: ProjectSummary[]
  fileName: string
  format: 'banded' | 'flat'
  savedAt: string
  savedByName: string | null
} | null

function toSlot(x: { state?: { projects: ProjectSummary[]; fileName: string; format: 'banded' | 'flat'; savedAt: string }; updatedByName?: string | null } | null | undefined): ReportSlot {
  if (!x?.state) return null
  return {
    projects: x.state.projects,
    fileName: x.state.fileName,
    format: x.state.format,
    savedAt: x.state.savedAt,
    savedByName: x.updatedByName ?? null,
  }
}

export function ProcurementTrackerClient({ isAdmin = false, closedProjects = [] }: { isAdmin?: boolean; closedProjects?: string[] }) {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two IN4 report slots, merged into one view (see lib/procurement/merge):
  //   indentSlot = Indent-to-Issue report (Needs-PO source)
  //   poSlot     = PO report (accurate + priced)
  const [indentSlot, setIndentSlot] = useState<ReportSlot>(null)
  const [poSlot, setPoSlot] = useState<ReportSlot>(null)
  const [selectedProject, setSelectedProject] = useState<string>('__all__')
  const [view, setView] = useState<View>('pending')
  const [diff, setDiff] = useState<SnapshotDiff | null>(null)
  /**
   * Projects that the Admin has hidden for the current signed-in
   * user via /admin/procurement-projects. Drives a filter applied
   * before chips and lines are rendered. Fetched once on mount.
   */
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set())
  // Per-indent chase notes (team-shared). Fetched once on mount; refreshed
  // in place after any save from the detail sheet.
  const [chaseNotes, setChaseNotes] = useState<Map<string, ChaseNote>>(new Map())
  // Tracks the initial /api/procurement-tracker/state hydration call so we
  // don't flash the empty-state Card for ~3s before the saved data arrives.
  // Starts `true`; flips to `false` once the fetch resolves (success or fail).
  const [isHydrating, setIsHydrating] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Drag counter — keeps the page-wide drop overlay stable as the cursor
  // crosses nested child elements (HTML drag events fire enter/leave for
  // every descendant, not just the wrapper).
  const dragCounter = useRef(0)

  // Fetch the per-user hidden-projects list once on mount. Admin-
  // managed via /procurement-tracker/admin. Best-effort.
  useEffect(() => {
    fetch('/api/procurement-tracker/my-hidden-projects')
      .then(r => r.ok ? r.json() : { hidden: [] })
      .then(json => {
        if (Array.isArray(json?.hidden)) setHiddenProjects(new Set(json.hidden))
      })
      .catch(() => { /* swallow */ })
  }, [])

  // Fetch the team-shared chase notes once on mount. Best-effort.
  useEffect(() => {
    fetch('/api/procurement-tracker/chase-notes')
      .then(r => r.ok ? r.json() : { notes: [] })
      .then(json => {
        if (Array.isArray(json?.notes)) {
          setChaseNotes(new Map((json.notes as ChaseNote[]).map(n => [n.indentNo, n])))
        }
      })
      .catch(() => { /* swallow */ })
  }, [])

  // Merge one freshly-saved note back into the map (called by the detail sheet).
  const onNoteSaved = useCallback((n: ChaseNote) => {
    setChaseNotes(prev => {
      const next = new Map(prev)
      next.set(n.indentNo, n)
      return next
    })
  }, [])

  // "Not ordering" list (team-shared). Keys are content-based (indent¦block¦material).
  const [droppedList, setDroppedList] = useState<DroppedLine[]>([])
  const droppedKeys = useMemo(() => new Set(droppedList.map(d => d.lineKey)), [droppedList])
  const refreshDropped = useCallback(() => {
    fetch('/api/procurement-tracker/dropped')
      .then(r => r.ok ? r.json() : { dropped: [] })
      .then(json => { if (Array.isArray(json?.dropped)) setDroppedList(json.dropped as DroppedLine[]) })
      .catch(() => { /* swallow */ })
  }, [])
  useEffect(() => { refreshDropped() }, [refreshDropped])

  // Pull BOTH report slots from the shared org-wide state. Any user landing
  // on the page sees the latest of each without re-uploading.
  const refetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/procurement-tracker/state')
      if (!res.ok) return
      const json = await res.json()
      setIndentSlot(toSlot(json.indent))
      setPoSlot(toSlot(json.po))
    } catch { /* swallow */ }
  }, [])

  useEffect(() => { refetchState().finally(() => setIsHydrating(false)) }, [refetchState])

  const handleFile = useCallback(async (file: File) => {
    setIsLoading(true); setError(null); setDiff(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/procurement-tracker/analyse', { method: 'POST', body: formData })
      const json: AnalyseResponse = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'Something went wrong.')
        return
      }
      // Diff is computed server-side against the prior persisted state.
      setDiff(json.diff ? hydrateDiff(json.diff) : null)
      setSelectedProject('__all__')
      setView('pending')
      // Auto-routed to its slot ('global' or 'po') by format; pull both back
      // so the merged view reflects this upload AND the other report.
      await refetchState()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [refetchState])

  // The merged, priced view: PO report drives everything it covers, the
  // Indent-to-Issue report fills the Needs-PO gap. Never loses data.
  const data = useMemo<AnalyseResponse | null>(() => {
    const merged = mergeReports(poSlot?.projects, indentSlot?.projects)
    if (merged.length === 0) return null
    return {
      success: true,
      fileName: [indentSlot?.fileName, poSlot?.fileName].filter(Boolean).join('  +  ') || 'procurement',
      format: poSlot ? 'flat' : 'banded',
      projects: merged,
    } as AnalyseResponse
  }, [indentSlot, poSlot])

  // Freshness/header metadata derived from whichever slot is newer.
  const newerSlot = useMemo<ReportSlot>(() => {
    if (indentSlot && poSlot) return indentSlot.savedAt >= poSlot.savedAt ? indentSlot : poSlot
    return indentSlot ?? poSlot
  }, [indentSlot, poSlot])
  const savedAt = newerSlot?.savedAt ?? null

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault(); setIsDragging(false); dragCounter.current = 0
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    }, [handleFile],
  )
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = '' // allow re-uploading the same filename
  }
  // Page-wide drag handlers. Overlay only shows while a *file* is being
  // dragged (we filter on dataTransfer.types) so accidental text-selects
  // don't trigger it.
  function isFileDrag(e: React.DragEvent): boolean {
    const types = e.dataTransfer?.types
    if (!types) return false
    for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true
    return false
  }
  const onPageDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    dragCounter.current += 1
    setIsDragging(true)
  }
  const onPageDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
  }
  const onPageDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDragging(false)
  }

  // Apply Admin's hide list BEFORE anything else uses `data.projects`.
  // visibleProjects is the filtered slice used by the chip grid, the
  // line filters, and the count badges.
  const visibleProjects = useMemo(() => {
    if (!data) return []
    if (hiddenProjects.size === 0) return data.projects
    return data.projects.filter(p => !hiddenProjects.has(p.projectName))
  }, [data, hiddenProjects])
  const hiddenInUploadCount = (data?.projects.length ?? 0) - visibleProjects.length

  // Filter lines by selected project. "__all__" = aggregate across every VISIBLE project.
  // Items marked "not ordering" are dropped here, so they vanish from every
  // list + count (they only reappear in the manage-dropped panel).
  const linesForActiveProject = useMemo<LineRecord[]>(() => {
    if (!data) return []
    const base = selectedProject === '__all__'
      ? visibleProjects.flatMap(p => p.lines)
      : (visibleProjects.find(p => p.projectName === selectedProject)?.lines ?? [])
    return droppedKeys.size === 0 ? base : base.filter(l => !droppedKeys.has(dropKey(l)))
  }, [data, selectedProject, visibleProjects, droppedKeys])

  // Every visible line across ALL projects (minus "not ordering") — the pool
  // the universal search box looks through, independent of the active project.
  const allVisibleLines = useMemo<LineRecord[]>(() => {
    const base = visibleProjects.flatMap(p => p.lines)
    return droppedKeys.size === 0 ? base : base.filter(l => !droppedKeys.has(dropKey(l)))
  }, [visibleProjects, droppedKeys])

  // Jump from a search hit to where it lives: its project + the matching view.
  const handleSearchPick = useCallback((line: LineRecord) => {
    setSelectedProject(line.project)
    setView(line.status === 'no_po' ? 'needs-po' : line.status === 'received' ? 'completed' : 'pending')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const pendingCount = useMemo(
    () => linesForActiveProject.filter(l => l.pendingQty > 0).length,
    [linesForActiveProject],
  )
  const needsPoCount = useMemo(
    () => linesForActiveProject.filter(l => l.status === 'no_po').length,
    [linesForActiveProject],
  )
  const completedCount = useMemo(
    () => linesForActiveProject.filter(l => l.status === 'received' && l.pos.length > 0 && l.grns.length > 0).length,
    [linesForActiveProject],
  )
  // 30+ day items drive the red "overdue" marker on the tab badges.
  const pendingOverdue = useMemo(
    () => linesForActiveProject.filter(l => l.pendingQty > 0 && (l.indentAgeDays ?? 0) >= 30).length,
    [linesForActiveProject],
  )
  const needsPoOverdue = useMemo(
    () => linesForActiveProject.filter(l => l.status === 'no_po' && (l.indentAgeDays ?? 0) >= 30).length,
    [linesForActiveProject],
  )

  // Data freshness — surfaced above the tabs so nobody acts on stale numbers.
  const freshness = useMemo(() => {
    if (!savedAt) return null
    const ms = Date.parse(savedAt)
    if (Number.isNaN(ms)) return null
    // eslint-disable-next-line react-hooks/purity
    const ageMs = Date.now() - ms
    const days = Math.floor(ageMs / 86_400_000)
    return {
      stale: ageMs > 36 * 3_600_000,
      label: days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`,
    }
  }, [savedAt])

  const activeProjectLabel = selectedProject === '__all__'
    ? (data?.fileName?.replace(/\.xlsx?$/, '') ?? 'All projects')
    : selectedProject

  return (
    <div
      className="min-h-screen bg-orange-50/40"
      onDragEnter={onPageDragEnter}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onDrop}
    >
      {/* Page-wide drop overlay — only visible while the user is actively
          dragging a file. Pointer-events disabled so React still receives
          the drop event on the wrapper underneath. */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-orange-900/15 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl px-8 py-7 shadow-2xl border-2 border-dashed border-orange-700 text-center">
            <Upload className="h-10 w-10 text-orange-700 mx-auto mb-2" />
            <p className="text-base font-semibold text-stone-900">Drop the IN4 .xlsx anywhere</p>
            <p className="text-xs text-stone-500 mt-1">Indent to Issue / Purchase Order Report</p>
          </div>
        </div>
      )}

      {/* Single hidden file input — used by every upload affordance on the
          page (header icon, "Upload new" link, empty-state button) so the
          input survives state changes. */}
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileInput} />

      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-12 max-w-6xl mx-auto space-y-4">
        {/* Compact header */}
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-700 to-red-900 text-white font-extrabold text-xs flex items-center justify-center shadow-md">
              SRMD
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-red-900 leading-tight">Indent → PO Tracker</h1>
              <p className="text-xs text-stone-500 mt-0.5">
                What you&apos;re still waiting on — by vendor and by indent.
              </p>
              {isAdmin && (
                <Link
                  href="/procurement-tracker/admin"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-700 hover:text-orange-900 hover:underline mt-1"
                  title="Hide specific projects from specific users"
                >
                  <EyeOff className="h-3 w-3" />
                  Follow-up email &amp; visibility
                </Link>
              )}
            </div>
          </div>
          {/* Right cluster: always-on Upload icon + (when present) savedAt info */}
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              {data && linesForActiveProject.length > 0 && (
                <button
                  type="button"
                  onClick={() => buildTrackerSummaryPdf(
                    linesForActiveProject,
                    activeProjectLabel,
                    savedAt ? formatSavedAt(savedAt) : '—',
                  )}
                  title="Download a one-page follow-up summary (PDF) — headline numbers + what to chase first"
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:border-stone-500 hover:text-stone-900 hover:bg-stone-50 transition-colors shadow-sm"
                >
                  <FileText className="h-4 w-4" />
                  <span className="hidden sm:inline">PDF</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                title="Upload IN4 'Indent to Issue / Purchase Order Report' (.xlsx) — or drop the file anywhere on this page"
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-orange-300 bg-white text-xs font-medium text-stone-700 hover:border-orange-700 hover:text-orange-700 hover:bg-orange-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="hidden sm:inline">{isLoading ? 'Uploading…' : 'Upload'}</span>
              </button>
            </div>
            {(indentSlot || poSlot) && (
              <div className="text-right text-[11px] leading-tight space-y-0.5">
                <div className={indentSlot ? 'text-stone-600' : 'text-stone-400'}>
                  {indentSlot
                    ? <>Indent report · <span className="text-stone-500">{formatSavedAt(indentSlot.savedAt)}</span></>
                    : 'Indent report · not uploaded'}
                </div>
                <div className={poSlot ? 'text-emerald-700 font-medium' : 'text-amber-600'}>
                  {poSlot
                    ? <>PO report (priced) · <span className="text-stone-500 font-normal">{formatSavedAt(poSlot.savedAt)}</span></>
                    : 'PO report · add it for real ₹ + quantities'}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Initial-hydration placeholder. The server-state fetch is async
            (~1-3s), so without this we'd flash the empty-state Card before
            the real data arrives. Keep it quiet — no big spinner, no copy
            that competes with the real UI. */}
        {isHydrating && (
          <Card className="p-8 text-center bg-white border-orange-200">
            <Loader2 className="h-5 w-5 text-orange-700 animate-spin inline mr-2" />
            <span className="text-stone-500 text-sm align-middle">Loading saved data…</span>
          </Card>
        )}

        {/* Compact empty state — only AFTER hydration finishes with nothing
            saved. No giant dashed dropzone; the icon above + page-wide drop
            cover the upload affordances. */}
        {!isHydrating && !data && !isLoading && !savedAt && !error && (
          <Card className="p-8 md:p-10 text-center bg-white border-orange-200">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-orange-100 text-orange-700 flex items-center justify-center mb-3">
              <Upload className="h-6 w-6" />
            </div>
            <p className="text-stone-800 font-semibold text-base mb-1">No procurement data yet</p>
            <p className="text-stone-500 text-sm mb-4">
              Click <b>Upload</b> at the top right, or drop the IN4 export anywhere on this page — it&apos;ll be saved for the whole team.
            </p>
            <p className="text-xs text-stone-500 bg-orange-50 border border-orange-100 inline-flex items-center gap-1.5 px-3 py-1 rounded-full">
              <FileSpreadsheet className="h-3 w-3" />
              IN4 → Reports → Purchase → Indent to Issue / Purchase Order Report
            </p>
          </Card>
        )}

        {isLoading && (
          <Card className="p-12 flex flex-col items-center justify-center bg-white border-orange-200">
            <Loader2 className="h-7 w-7 text-orange-700 animate-spin mb-3" />
            <p className="text-stone-500 text-sm">Analysing procurement data…</p>
          </Card>
        )}

        {error && (
          <Card className="bg-red-50 border-red-200 p-5 text-red-700 text-sm">
            <strong>Error: </strong>{error}
          </Card>
        )}

        {data && (
          <div className="space-y-4">
            {/* Universal search — find any item across every project & status */}
            <UniversalSearch lines={allVisibleLines} onPick={handleSearchPick} />

            {/* Data health — self-report what IN4 didn't hand over cleanly */}
            <DataHealth lines={allVisibleLines} onPick={handleSearchPick} />

            {/* What changed since last upload */}
            {diff && (diff.newLineIds.size > 0 || diff.changedLineIds.size > 0) && (
              <DiffBanner diff={diff} />
            )}

            {/* Project filter — smarter strip: insight ribbon, search,
                active/cleared split, richer chips. Admin-hidden projects
                are stripped from `visibleProjects` upstream. */}
            {visibleProjects.length > 1 && (
              <ProjectFilterStrip
                projects={visibleProjects}
                selectedProject={selectedProject}
                onSelect={setSelectedProject}
                format={data.format}
                hiddenInUploadCount={hiddenInUploadCount}
                closedProjects={closedProjects}
              />
            )}

            {/* Data freshness — scrolls away; amber when stale */}
            {freshness && (
              <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-1.5 border ${
                freshness.stale ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-stone-50 border-stone-200 text-stone-500'
              }`}>
                <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="min-w-0">
                  Data as of <b className="text-stone-700">{savedAt ? formatSavedAt(savedAt) : '—'}</b> · updated {freshness.label}
                  {freshness.stale && <span className="font-medium"> — may be stale, ask for a fresh upload</span>}
                </span>
              </div>
            )}

            {/* The toggle — the entire page hinges on this. Sticky so it stays
                reachable on long lists (below the mobile top-nav; top on desktop). */}
            <div className="sticky top-14 md:top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-orange-50/90 supports-[backdrop-filter]:bg-orange-50/70 backdrop-blur">
            <div className="grid grid-cols-3 gap-2 bg-white rounded-xl border border-orange-200 p-1 shadow-sm">
              <button
                onClick={() => setView('pending')}
                className={`flex items-center justify-center gap-2 px-2 py-3 rounded-lg text-sm font-semibold transition-colors ${
                  view === 'pending'
                    ? 'bg-gradient-to-br from-orange-700 to-red-900 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-orange-50'
                }`}
              >
                <PackageX className={`h-4 w-4 ${view === 'pending' ? '' : 'text-amber-600'}`} />
                <span className="hidden sm:inline">Pending receipts</span>
                <span className="sm:hidden">Pending</span>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${
                  view === 'pending' ? 'bg-white/20 text-white' : pendingOverdue > 0 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                }`} title={pendingOverdue > 0 ? `${pendingOverdue} item(s) 30+ days overdue` : undefined}>
                  {pendingCount}{view !== 'pending' && pendingOverdue > 0 ? ` · ${pendingOverdue}!` : ''}
                </span>
              </button>
              <button
                onClick={() => setView('needs-po')}
                className={`flex items-center justify-center gap-2 px-2 py-3 rounded-lg text-sm font-semibold transition-colors ${
                  view === 'needs-po'
                    ? 'bg-gradient-to-br from-orange-700 to-red-900 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-orange-50'
                }`}
              >
                <ClipboardList className={`h-4 w-4 ${view === 'needs-po' ? '' : 'text-red-600'}`} />
                <span className="hidden sm:inline">Needing PO</span>
                <span className="sm:hidden">No PO</span>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${
                  view === 'needs-po' ? 'bg-white/20 text-white' : needsPoOverdue > 0 ? 'bg-red-100 text-red-800' : 'bg-red-50 text-red-700'
                }`} title={needsPoOverdue > 0 ? `${needsPoOverdue} item(s) 30+ days overdue` : undefined}>
                  {needsPoCount}{view !== 'needs-po' && needsPoOverdue > 0 ? ` · ${needsPoOverdue}!` : ''}
                </span>
              </button>
              <button
                onClick={() => setView('completed')}
                className={`flex items-center justify-center gap-2 px-2 py-3 rounded-lg text-sm font-semibold transition-colors ${
                  view === 'completed'
                    ? 'bg-gradient-to-br from-orange-700 to-red-900 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-orange-50'
                }`}
                title="Cycle-time analysis on fully-delivered items"
              >
                <CheckCircle2 className={`h-4 w-4 ${view === 'completed' ? '' : 'text-emerald-600'}`} />
                <span className="hidden sm:inline">Completed</span>
                <span className="sm:hidden">Done</span>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${
                  view === 'completed' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {completedCount}
                </span>
              </button>
            </div>
            </div>

            {/* Active view */}
            {view === 'pending' && (
              <PendingReceiptsView
                lines={linesForActiveProject}
                projectName={activeProjectLabel}
                newLineIds={diff?.newLineIds}
                changedLineIds={diff?.changedLineIds}
                chaseNotes={chaseNotes}
                onNoteSaved={onNoteSaved}
                onDropped={refreshDropped}
              />
            )}
            {view === 'needs-po' && (
              <IndentsNeedingPoView
                lines={linesForActiveProject}
                projectName={activeProjectLabel}
                newLineIds={diff?.newLineIds}
                changedLineIds={diff?.changedLineIds}
                chaseNotes={chaseNotes}
                onNoteSaved={onNoteSaved}
                onDropped={refreshDropped}
              />
            )}
            {view === 'completed' && (
              <CompletedView
                lines={linesForActiveProject}
                projectName={activeProjectLabel}
              />
            )}

            {/* Manage the "not ordering" list — restore anything hidden */}
            <DroppedItemsPanel dropped={droppedList} onChanged={refreshDropped} />
          </div>
        )}
      </div>
    </div>
  )
}
