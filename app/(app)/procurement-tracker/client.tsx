'use client'

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import type { ParseResult, ProjectSummary, LineRecord, SnapshotDiff, IndentStatus, TrendPoint } from '@/lib/procurement'
import {
  loadStoredSnapshot, loadPreviousIndents, loadPreviousMeta, loadTrend,
  saveSnapshot, clearAll, computeDiff, formatSavedAt,
} from '@/lib/procurement/storage'
import { SummaryCards } from '@/components/procurement-tracker/SummaryCards'
import { DisciplineChart } from '@/components/procurement-tracker/DisciplineChart'
import { IndentTable } from '@/components/procurement-tracker/IndentTable'
import { ActionStrip } from '@/components/procurement-tracker/ActionStrip'
import { FunnelBand } from '@/components/procurement-tracker/FunnelBand'
import { TopVendors } from '@/components/procurement-tracker/TopVendors'
import { PendingReceiptsView } from '@/components/procurement-tracker/PendingReceiptsView'
import { DiffBanner } from '@/components/procurement-tracker/DiffBanner'
import { TrendRibbon } from '@/components/procurement-tracker/TrendRibbon'
import { Upload, FileSpreadsheet, Loader2, AlertOctagon } from 'lucide-react'

type AnalyseResponse = ParseResult & {
  success: boolean
  fileName: string
  error?: string
}

type View = 'project' | 'pending'

export function ProcurementTrackerClient() {
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AnalyseResponse | null>(null)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [view, setView] = useState<View>('project')
  const [indentFilter, setIndentFilter] = useState<IndentStatus | 'all'>('all')
  const [diff, setDiff] = useState<SnapshotDiff | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const indentTableRef = useRef<HTMLDivElement>(null)

  // Restore from localStorage on mount.
  useEffect(() => {
    const snap = loadStoredSnapshot()
    if (!snap) return
    // We can't fully restore a ParseResult from the snapshot alone since
    // we only persist indent statuses (full data is large). Instead, hint
    // the user to re-upload to get the dashboard back — they can keep the
    // diff baseline. (Real-world: keeping just statuses keeps localStorage
    // small. Trend ribbon still works.)
    setSavedAt(snap.savedAt)
    setTrend(loadTrend())
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
      setSelectedProject(json.projects[0]?.projectName ?? null)
      setView('project')

      // Compute diff against previous snapshot BEFORE saving (which moves
      // current → previous and would otherwise lose the baseline).
      const prevIndents = loadPreviousIndents()
      const prevMeta = loadPreviousMeta()
      const newDiff = computeDiff(json.projects.flatMap(p => p.indents), prevIndents, prevMeta)
      setDiff(newDiff)

      saveSnapshot({ format: json.format, projects: json.projects }, file.name)
      setSavedAt(new Date().toISOString())
      setTrend(loadTrend())
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

  const currentSummary = data?.projects.find(s => s.projectName === selectedProject)
  const allLines = useMemo<LineRecord[]>(() => data ? data.projects.flatMap(s => s.lines) : [], [data])
  const totalPendingLines = useMemo(() => allLines.filter(l => l.pendingQty > 0).length, [allLines])

  function jumpToPending() { setView('pending') }
  function jumpToIndentTable(filter: IndentStatus | 'all') {
    setView('project')
    setIndentFilter(filter)
    setTimeout(() => indentTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function clearSaved() {
    clearAll()
    setData(null); setDiff(null); setSavedAt(null); setTrend([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="min-h-screen bg-orange-50/40">
      <div className="px-4 md:px-6 pt-4 md:pt-6 pb-12 max-w-7xl mx-auto space-y-4">
        {/* Branded header (saffron palette) */}
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-700 to-red-900 text-white font-extrabold text-xs flex items-center justify-center shadow-md">
              SRMD
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-red-900 leading-tight">Indent → PO Tracker</h1>
              <p className="text-xs text-stone-500 mt-0.5">
                Drop your IN4 procurement Excel — supports both <b>PURCHINDENT_TO_ISSUE_RPT</b> and <b>PUR_PurchaseOrderReport</b>
              </p>
            </div>
          </div>
          {savedAt && (
            <div className="text-right text-[11px] text-stone-500">
              <div className="text-stone-700 font-medium">{data?.fileName ?? 'Saved upload'}</div>
              <div>
                Saved {formatSavedAt(savedAt)}
                {' · '}
                <button onClick={clearSaved} className="text-orange-700 hover:underline">Clear saved data</button>
              </div>
              <TrendRibbon trend={trend} />
            </div>
          )}
        </header>

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
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs bg-orange-100 text-orange-800 rounded-full px-3 py-1 inline-flex items-center gap-1.5">
                <FileSpreadsheet className="h-3 w-3" />
                {data.fileName}
              </span>
              <span className="text-[11px] text-stone-500">
                <b className="text-stone-700">{data.format.toUpperCase()}</b> · {data.projects.length} project{data.projects.length !== 1 ? 's' : ''} found
              </span>
            </div>

            {diff && diff.changedIndents.size > 0 && (
              <DiffBanner diff={diff} />
            )}

            <div className="border-b border-orange-200 flex flex-wrap gap-1 -mb-px">
              <button
                onClick={() => setView('project')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  view === 'project'
                    ? 'border-orange-700 text-orange-900'
                    : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}
              >
                By project
              </button>
              <button
                onClick={jumpToPending}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors inline-flex items-center gap-2 ${
                  view === 'pending'
                    ? 'border-orange-700 text-orange-900'
                    : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}
              >
                <AlertOctagon className="h-3.5 w-3.5" />
                Pending receipts
                {totalPendingLines > 0 && (
                  <span className={`ml-1 text-[11px] font-semibold rounded-full px-1.5 py-0.5 ${
                    view === 'pending' ? 'bg-orange-100 text-orange-800' : 'bg-stone-200 text-stone-600'
                  }`}>
                    {totalPendingLines}
                  </span>
                )}
              </button>
            </div>

            {view === 'pending' ? (
              <PendingReceiptsView lines={allLines} projectName={data.fileName.replace(/\.xlsx?$/, '')} />
            ) : (
              <>
                {data.projects.length > 1 && (
                  <div className="flex gap-2 flex-wrap">
                    {data.projects.map(s => (
                      <button
                        key={s.projectName}
                        onClick={() => setSelectedProject(s.projectName)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                          selectedProject === s.projectName
                            ? 'bg-red-900 text-white shadow-sm'
                            : 'bg-white border border-orange-200 text-stone-600 hover:bg-orange-50'
                        }`}
                      >
                        {s.projectName}
                        <span className={`ml-2 text-xs ${selectedProject === s.projectName ? 'opacity-70' : 'text-stone-400'}`}>
                          {s.total}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {currentSummary && (
                  <>
                    <ActionStrip summary={currentSummary} onJumpToIndent={jumpToIndentTable} onJumpToPending={jumpToPending} />
                    <SummaryCards
                      summary={currentSummary}
                      onJumpToPending={jumpToPending}
                      onJumpToIndent={jumpToIndentTable}
                    />
                    <FunnelBand summary={currentSummary} onJumpToIndent={jumpToIndentTable} />
                    <DisciplineChart summary={currentSummary} />
                    <div ref={indentTableRef}>
                      <IndentTable
                        indents={currentSummary.indents}
                        lines={currentSummary.lines}
                        projectName={currentSummary.projectName}
                        format={data.format}
                        changedIndents={diff?.changedIndents}
                        externalStatusFilter={indentFilter}
                        onExternalStatusFilterChange={setIndentFilter}
                      />
                    </div>
                    <TopVendors vendors={currentSummary.topVendors} hasInvoices={data.format === 'flat'} />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
