'use client'
// Two dropzones — IN4 Abstract Report (primary) + WO Detail Report (secondary).
// Each shows a status + results after upload. Bottom shows recent import log.

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Upload, FileSpreadsheet, Check, AlertTriangle, Info } from 'lucide-react'
import { importIn4Abstract, importIn4WoDetail } from './actions'

interface UploadLog {
  id: string
  source: string
  file_name: string | null
  rows_total: number | null
  rows_inserted: number | null
  rows_skipped: number | null
  error_log: { errors?: string[] } | null
  created_at: string
}

interface Props {
  uploadLogs: UploadLog[]
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; message: string } | { kind: 'err'; message: string }

export function ImportPanel({ uploadLogs }: Props) {
  const router = useRouter()
  const [abstractStatus, setAbstractStatus] = useState<Status>({ kind: 'idle' })
  const [woStatus, setWoStatus] = useState<Status>({ kind: 'idle' })
  const abstractRef = useRef<HTMLInputElement | null>(null)
  const woRef = useRef<HTMLInputElement | null>(null)

  async function uploadAbstract(file: File) {
    setAbstractStatus({ kind: 'busy' })
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await importIn4Abstract(fd)
      setAbstractStatus({ kind: res.ok ? 'ok' : 'err', message: res.message })
      router.refresh()
    } catch (e) {
      setAbstractStatus({ kind: 'err', message: e instanceof Error ? e.message : 'Import failed' })
    }
  }

  async function uploadWo(file: File) {
    setWoStatus({ kind: 'busy' })
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await importIn4WoDetail(fd)
      setWoStatus({ kind: res.ok ? 'ok' : 'err', message: res.message })
      router.refresh()
    } catch (e) {
      setWoStatus({ kind: 'err', message: e instanceof Error ? e.message : 'Import failed' })
    }
  }

  return (
    <div className="space-y-4" id="import">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Dropzone
          title="IN4 BOQ Abstract Report"
          subtitle="Primary source — populates the entire rate library in one click."
          hint="Expected file: ENGGBOQABSTRACTREPORT_New.xlsx"
          inputRef={abstractRef}
          status={abstractStatus}
          accent="emerald"
          onFile={uploadAbstract}
        />
        <Dropzone
          title="IN4 WO Detail Report"
          subtitle="Adds WO totals + status to the Past WOs panel."
          hint="Expected file: ENGGWorkOrderDetailReport.xlsx"
          inputRef={woRef}
          status={woStatus}
          accent="amber"
          onFile={uploadWo}
        />
      </div>

      {/* How to extract from IN4 */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 flex items-center gap-1.5">
            <Info className="h-4 w-4 text-blue-500" /> How to get these files from IN4suite
          </h3>
          <ol className="text-sm text-gray-600 space-y-1 list-decimal pl-5">
            <li>Open IN4suite → look for the <b>Reports</b> module</li>
            <li>For the rate library: open <b>ENGG BOQ Abstract Report</b> → don&apos;t filter → Export to Excel</li>
            <li>For WO history: open <b>ENGG Work Order Detail Report</b> → Export to Excel</li>
            <li>Drop the .xlsx files in the boxes above. Re-import any time to refresh — duplicates are skipped automatically.</li>
          </ol>
        </CardContent>
      </Card>

      {/* Recent imports */}
      {uploadLogs.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2">Recent imports</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
                    <th className="px-2 py-2">When</th>
                    <th className="px-2 py-2">Source</th>
                    <th className="px-2 py-2">File</th>
                    <th className="px-2 py-2 text-right">Rows</th>
                    <th className="px-2 py-2 text-right">Inserted</th>
                    <th className="px-2 py-2 text-right">Skipped</th>
                    <th className="px-2 py-2">Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadLogs.map(l => (
                    <tr key={l.id} className="border-b border-gray-100">
                      <td className="px-2 py-2 text-xs text-gray-500">{new Date(l.created_at).toLocaleString('en-IN')}</td>
                      <td className="px-2 py-2 font-mono text-xs">{l.source}</td>
                      <td className="px-2 py-2 truncate max-w-xs" title={l.file_name ?? ''}>{l.file_name}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{l.rows_total}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{l.rows_inserted}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-400">{l.rows_skipped}</td>
                      <td className="px-2 py-2 text-xs text-amber-700">
                        {l.error_log?.errors?.length ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Dropzone({
  title, subtitle, hint, inputRef, status, accent, onFile,
}: {
  title: string
  subtitle: string
  hint: string
  inputRef: React.MutableRefObject<HTMLInputElement | null>
  status: Status
  accent: 'emerald' | 'amber'
  onFile: (f: File) => void
}) {
  const [dragging, setDragging] = useState(false)
  const accentClasses = accent === 'emerald'
    ? 'border-emerald-200 bg-emerald-50/30 hover:border-emerald-400'
    : 'border-amber-200 bg-amber-50/30 hover:border-amber-400'

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <h3 className="text-base font-bold text-gray-900 mb-1">{title}</h3>
        <p className="text-xs text-gray-500 mb-3">{subtitle}</p>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${accentClasses} ${dragging ? 'ring-2 ring-blue-400' : ''}`}
        >
          <FileSpreadsheet className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-gray-700">Drop .xlsx here or click to browse</p>
          <p className="text-[11px] text-gray-400 mt-1">{hint}</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
            }}
          />
        </div>

        <div className="mt-3 min-h-[2rem]">
          {status.kind === 'busy' && (
            <p className="text-sm text-gray-600 inline-flex items-center gap-1.5">
              <Loader2 className="h-4 w-4 animate-spin" /> Importing…
            </p>
          )}
          {status.kind === 'ok' && (
            <p className="text-sm text-emerald-700 inline-flex items-start gap-1.5">
              <Check className="h-4 w-4 mt-0.5" /> {status.message}
            </p>
          )}
          {status.kind === 'err' && (
            <p className="text-sm text-rose-700 inline-flex items-start gap-1.5">
              <AlertTriangle className="h-4 w-4 mt-0.5" /> {status.message}
            </p>
          )}
        </div>

        <Button
          type="button"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={status.kind === 'busy'}
          className="mt-1"
        >
          <Upload className="h-4 w-4" /> Choose file
        </Button>
      </CardContent>
    </Card>
  )
}
