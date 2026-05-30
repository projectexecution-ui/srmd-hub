'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import type { ProjectSummary, LineRecord } from '@/lib/procurement-tracker'
import { SummaryCards } from '@/components/procurement-tracker/SummaryCards'
import { DisciplineChart } from '@/components/procurement-tracker/DisciplineChart'
import { IndentTable } from '@/components/procurement-tracker/IndentTable'
import { ActionStrip } from '@/components/procurement-tracker/ActionStrip'
import { FunnelBand } from '@/components/procurement-tracker/FunnelBand'
import { TopVendors } from '@/components/procurement-tracker/TopVendors'
import { PendingReceiptsView } from '@/components/procurement-tracker/PendingReceiptsView'
import { Upload, FileSpreadsheet, Loader2, AlertOctagon } from 'lucide-react'

type AnalyseResponse = {
  success: boolean
  fileName: string
  totalProjects: number
  summaries: ProjectSummary[]
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setIsLoading(true); setError(null); setData(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/procurement-tracker/analyse', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || 'Something went wrong.')
      } else {
        setData(json)
        setSelectedProject(json.summaries[0]?.projectName ?? null)
        setView('project')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const currentSummary = data?.summaries.find(s => s.projectName === selectedProject)

  // For the Pending Receipts tab we want every line across every project so
  // the user can chase vendors holistically. They can still filter by
  // project via the dropdown there if useful — for now we concat them all.
  const allLines = useMemo<LineRecord[]>(() => {
    if (!data) return []
    return data.summaries.flatMap(s => s.lines)
  }, [data])

  const totalPendingLines = useMemo(
    () => allLines.filter(l => l.pendingQty > 0).length,
    [allLines],
  )

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Procurement Tracker"
        subtitle="Upload PURCHINDENT_TO_ISSUE_RPT — see what's ordered, received, and still owed"
        back="/dashboard"
      >
        {data && (
          <button
            onClick={() => {
              setData(null); setError(null); setView('project')
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
            className="text-xs text-stone-500 hover:text-stone-700 border border-stone-200 rounded-lg px-3 py-1.5 hover:bg-stone-50 transition-colors"
          >
            ↑ Upload new file
          </button>
        )}
      </PageHeader>

      {!data && !isLoading && (
        <Card
          onDrop={onDrop}
          onDragOver={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer border-2 border-dashed rounded-2xl p-12 md:p-16 text-center transition-all ${
            isDragging
              ? 'border-blue-500 bg-blue-50'
              : 'border-stone-300 bg-white hover:border-stone-400 hover:bg-stone-50'
          }`}
        >
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileInput} />
          <FileSpreadsheet className="h-10 w-10 text-stone-400 mx-auto mb-3" />
          <p className="text-stone-700 font-medium text-base mb-1">Drop your PURCHINDENT_TO_ISSUE_RPT file here</p>
          <p className="text-stone-400 text-sm mb-4">or click to browse</p>
          <p className="text-xs text-stone-500 bg-stone-100 inline-flex items-center gap-1.5 px-3 py-1 rounded-full">
            <Upload className="h-3 w-3" />
            .xlsx · Export from ERP → Reports → Purchase → Indent to Issue
          </p>
        </Card>
      )}

      {isLoading && (
        <Card className="p-12 flex flex-col items-center justify-center">
          <Loader2 className="h-7 w-7 text-stone-500 animate-spin mb-3" />
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
            <span className="text-xs bg-stone-200 text-stone-600 rounded-full px-3 py-1 inline-flex items-center gap-1">
              <FileSpreadsheet className="h-3 w-3" />
              {data.fileName}
            </span>
            <span className="text-xs text-stone-400">
              {data.totalProjects} project{data.totalProjects !== 1 ? 's' : ''} found
            </span>
          </div>

          {/* Top-level tabs: project view vs pending-receipts cross-project view */}
          <div className="border-b border-stone-200 flex flex-wrap gap-1 -mb-px">
            <button
              onClick={() => setView('project')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                view === 'project'
                  ? 'border-stone-800 text-stone-900'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              By project
            </button>
            <button
              onClick={() => setView('pending')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors inline-flex items-center gap-2 ${
                view === 'pending'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              <AlertOctagon className="h-3.5 w-3.5" />
              Pending receipts
              {totalPendingLines > 0 && (
                <span className={`ml-1 text-[11px] font-semibold rounded-full px-1.5 py-0.5 ${
                  view === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-stone-200 text-stone-600'
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
              {data.summaries.length > 1 && (
                <div className="flex gap-2 flex-wrap">
                  {data.summaries.map(s => (
                    <button
                      key={s.projectName}
                      onClick={() => setSelectedProject(s.projectName)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                        selectedProject === s.projectName
                          ? 'bg-stone-800 text-white'
                          : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
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
                  <ActionStrip summary={currentSummary} />
                  <SummaryCards summary={currentSummary} />
                  <FunnelBand summary={currentSummary} />
                  <DisciplineChart summary={currentSummary} />
                  <IndentTable
                    indents={currentSummary.indents}
                    lines={currentSummary.lines}
                    projectName={currentSummary.projectName}
                  />
                  <TopVendors vendors={currentSummary.topVendors} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
