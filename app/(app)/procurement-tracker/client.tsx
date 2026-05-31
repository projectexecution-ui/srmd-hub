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
import type { ParseResult, LineRecord, SnapshotDiff } from '@/lib/procurement'
import {
  loadStoredSnapshot, loadPreviousIndents, loadPreviousLineStatuses, loadPreviousMeta,
  saveSnapshot, clearAll, computeDiff, formatSavedAt,
} from '@/lib/procurement/storage'
import { PendingReceiptsView } from '@/components/procurement-tracker/PendingReceiptsView'
import { IndentsNeedingPoView } from '@/components/procurement-tracker/IndentsNeedingPoView'
import { DiffBanner } from '@/components/procurement-tracker/DiffBanner'
import { Upload, FileSpreadsheet, Loader2, PackageX, ClipboardList } from 'lucide-react'

type AnalyseResponse = ParseResult & {
  success: boolean
  fileName: string
  error?: string
}

type View = 'pending' | 'needs-po'

export function ProcurementTrackerClient() {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AnalyseResponse | null>(null)
  const [selectedProject, setSelectedProject] = useState<string>('__all__')
  const [view, setView] = useState<View>('pending')
  const [diff, setDiff] = useState<SnapshotDiff | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Rehydrate the full dashboard from the last upload on mount, so a
  // page reload does NOT lose Aksha's data. The full `projects[]` is
  // persisted in localStorage (see lib/procurement/storage.ts).
  // Legacy snapshots (saved before this fix) lack `projects` — for
  // those we still surface the savedAt marker so the user knows a
  // snapshot exists, and the upload zone falls through into the
  // re-upload prompt.
  useEffect(() => {
    const snap = loadStoredSnapshot()
    if (!snap) return
    setSavedAt(snap.savedAt)
    if (snap.projects && snap.projects.length > 0) {
      setData({
        success: true,
        fileName: snap.fileName,
        format: snap.format,
        projects: snap.projects,
      } as AnalyseResponse)
      setSelectedProject('__all__')
      setView('pending')
    }
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setIsLoading(true); setError(null); setData(null); setDiff(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/procurement-tracker/analyse', { method: 'POST', body: formData })
      const json: AnalyseResponse = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'Something went wrong.')
        return
      }
      setData(json)
      setSelectedProject('__all__')
      setView('pending')

      // Diff against previous snapshot BEFORE saveSnapshot rolls current → previous.
      const prevIndents = loadPreviousIndents()
      const prevLines = loadPreviousLineStatuses()
      const prevMeta = loadPreviousMeta()
      const newDiff = computeDiff(
        json.projects.flatMap(p => p.indents),
        json.projects.flatMap(p => p.lines),
        prevIndents,
        prevLines,
        prevMeta,
      )
      setDiff(newDiff)

      saveSnapshot({ format: json.format, projects: json.projects }, file.name)
      setSavedAt(new Date().toISOString())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault(); setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    }, [handleFile],
  )
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // Filter lines by selected project. "__all__" = aggregate across every project.
  const linesForActiveProject = useMemo<LineRecord[]>(() => {
    if (!data) return []
    if (selectedProject === '__all__') return data.projects.flatMap(p => p.lines)
    const proj = data.projects.find(p => p.projectName === selectedProject)
    return proj?.lines ?? []
  }, [data, selectedProject])

  const pendingCount = useMemo(
    () => linesForActiveProject.filter(l => l.pendingQty > 0).length,
    [linesForActiveProject],
  )
  const needsPoCount = useMemo(
    () => linesForActiveProject.filter(l => l.status === 'no_po').length,
    [linesForActiveProject],
  )

  function clearSaved() {
    clearAll()
    setData(null); setDiff(null); setSavedAt(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const activeProjectLabel = selectedProject === '__all__'
    ? (data?.fileName?.replace(/\.xlsx?$/, '') ?? 'All projects')
    : selectedProject

  return (
    <div className="min-h-screen bg-orange-50/40">
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
            </div>
          </div>
          {savedAt && (
            <div className="text-right text-[11px] text-stone-500">
              {data?.fileName && <div className="text-stone-700 font-medium">{data.fileName}</div>}
              <div>
                Saved {formatSavedAt(savedAt)}
                {' · '}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-orange-700 hover:underline"
                  title="Upload a fresh Excel — replaces the current saved data"
                >
                  Upload new
                </button>
                {' · '}
                <button onClick={clearSaved} className="text-orange-700 hover:underline">Clear saved data</button>
              </div>
              {/* Hidden input attached so "Upload new" works even when the
                  drop-zone Card isn't rendered (i.e. when data is loaded). */}
              {data && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={onFileInput}
                />
              )}
            </div>
          )}
        </header>

        {/* Upload zone (only when there's nothing to show) */}
        {!data && !isLoading && !savedAt && (
          <Card
            onDrop={onDrop}
            onDragOver={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border-2 border-dashed rounded-2xl p-12 md:p-16 text-center transition-all ${
              isDragging
                ? 'border-orange-700 bg-orange-50'
                : 'border-orange-300 bg-white hover:border-orange-500 hover:bg-orange-50/50'
            }`}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileInput} />
            <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-700 to-red-900 text-white flex items-center justify-center shadow-md mb-3">
              <Upload className="h-6 w-6" />
            </div>
            <p className="text-stone-800 font-semibold text-base mb-1">Drop your Excel here</p>
            <p className="text-stone-500 text-sm mb-4">or click to browse · max 20 MB · everything stays in your browser</p>
            <p className="text-xs text-stone-500 bg-orange-100 inline-flex items-center gap-1.5 px-3 py-1 rounded-full">
              <FileSpreadsheet className="h-3 w-3" />
              IN4 → Reports → Purchase → Indent to Issue / Purchase Order Report
            </p>
          </Card>
        )}

        {savedAt && !data && !isLoading && (
          <Card className="p-6 text-center border-orange-200 bg-white">
            <p className="text-stone-700 font-medium">Saved snapshot from {formatSavedAt(savedAt)}.</p>
            <p className="text-sm text-stone-500 mb-3">Re-upload your Excel to refresh the dashboard.</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-sm font-medium bg-orange-700 text-white px-4 py-2 rounded-lg hover:bg-orange-800"
            >
              <Upload className="h-4 w-4" /> Upload Excel
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileInput} />
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
            {/* What changed since last upload */}
            {diff && (diff.newLineIds.size > 0 || diff.changedLineIds.size > 0) && (
              <DiffBanner diff={diff} />
            )}

            {/* Project filter — chip grid so every project is one click away.
                Sorted by pendingLineCount desc so the projects you most
                need to chase bubble to the front. */}
            {data.projects.length > 1 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">
                    Filter by project
                  </label>
                  <span className="text-[11px] text-stone-400">
                    {data.format === 'flat'
                      ? `Per-project PO report · ${data.projects.length} project${data.projects.length === 1 ? '' : 's'}`
                      : `Company-wide indent report · ${data.projects.length} trade categories`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {/* "All projects" anchor chip — always first */}
                  <ProjectChip
                    label="All projects"
                    pendingCount={data.projects.reduce((s, p) => s + p.pendingLineCount, 0)}
                    selected={selectedProject === '__all__'}
                    onClick={() => setSelectedProject('__all__')}
                  />
                  {[...data.projects]
                    .sort((a, b) => b.pendingLineCount - a.pendingLineCount)
                    .map(p => (
                      <ProjectChip
                        key={p.projectName}
                        label={p.projectName}
                        pendingCount={p.pendingLineCount}
                        selected={selectedProject === p.projectName}
                        onClick={() => setSelectedProject(p.projectName)}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* The toggle — the entire page hinges on this */}
            <div className="grid grid-cols-2 gap-2 bg-white rounded-xl border border-orange-200 p-1">
              <button
                onClick={() => setView('pending')}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm font-semibold transition-colors ${
                  view === 'pending'
                    ? 'bg-gradient-to-br from-orange-700 to-red-900 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-orange-50'
                }`}
              >
                <PackageX className={`h-4 w-4 ${view === 'pending' ? '' : 'text-amber-600'}`} />
                <span>Pending receipts</span>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${
                  view === 'pending' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
                }`}>
                  {pendingCount}
                </span>
              </button>
              <button
                onClick={() => setView('needs-po')}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm font-semibold transition-colors ${
                  view === 'needs-po'
                    ? 'bg-gradient-to-br from-orange-700 to-red-900 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-orange-50'
                }`}
              >
                <ClipboardList className={`h-4 w-4 ${view === 'needs-po' ? '' : 'text-red-600'}`} />
                <span>Indents needing PO</span>
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${
                  view === 'needs-po' ? 'bg-white/20 text-white' : 'bg-red-100 text-red-800'
                }`}>
                  {needsPoCount}
                </span>
              </button>
            </div>

            {/* Active view */}
            {view === 'pending' ? (
              <PendingReceiptsView
                lines={linesForActiveProject}
                projectName={activeProjectLabel}
                newLineIds={diff?.newLineIds}
                changedLineIds={diff?.changedLineIds}
              />
            ) : (
              <IndentsNeedingPoView
                lines={linesForActiveProject}
                projectName={activeProjectLabel}
                newLineIds={diff?.newLineIds}
                changedLineIds={diff?.changedLineIds}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ProjectChip ──────────────────────────────────────────────────────
// One clickable chip for the project filter strip. Surfaces the project
// name + a pendingLineCount badge so the user can prioritise visually
// (amber = needs chasing, emerald = fully fulfilled).
function ProjectChip({
  label,
  pendingCount,
  selected,
  onClick,
}: {
  label: string
  pendingCount: number
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 max-w-full ${
        selected
          ? 'bg-red-900 text-white shadow-sm ring-2 ring-red-200'
          : 'bg-white border border-orange-200 text-stone-700 hover:bg-orange-50 hover:border-orange-400'
      }`}
    >
      <span className="truncate max-w-[180px]">{label}</span>
      <span
        className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none ${
          selected
            ? 'bg-white/20 text-white'
            : pendingCount > 0
              ? 'bg-amber-100 text-amber-800'
              : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {pendingCount}
      </span>
    </button>
  )
}
