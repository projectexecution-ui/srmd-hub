'use client'
import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Chart, registerables, type ChartOptions, type TooltipItem } from 'chart.js'
import { Upload, Printer, RotateCcw, FileSpreadsheet } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  formatINR, formatINRFull, toLakh,
  detectColumns, buildRows,
  type ParsedRow, type DetectedMap,
} from '@/lib/budget-utils'

Chart.register(...registerables)

export default function BudgetPage() {
  const [raw, setRaw] = useState<(string | number | null)[][] | null>(null)
  const [bestRow, setBestRow] = useState(0)
  const [headerRow, setHeaderRow] = useState<string[]>([])
  const [map, setMap] = useState<DetectedMap | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const mainChartRef = useRef<HTMLCanvasElement>(null)
  const varChartRef = useRef<HTMLCanvasElement>(null)
  const mainChartInst = useRef<Chart | null>(null)
  const varChartInst = useRef<Chart | null>(null)

  // ---------- File handling ----------
  function handleFile(file: File) {
    setError('')
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const sheetName = wb.SheetNames[0]
        const sheet = wb.Sheets[sheetName]
        const r = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
          header: 1, defval: null, raw: true,
        })
        if (!r.length) throw new Error('Sheet is empty.')
        processRaw(r)
      } catch (err) {
        setError('Could not read file: ' + (err instanceof Error ? err.message : String(err)))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function processRaw(r: (string | number | null)[][]) {
    const detected = detectColumns(r)
    const built = buildRows(r, detected.bestRow, detected.map)
    setRaw(r)
    setBestRow(detected.bestRow)
    setHeaderRow(detected.headerRow)
    setMap(detected.map)
    setRows(built)
    if (!built.length) {
      setError('Could not find any rows with both a description and a number. Try adjusting the column mapping below.')
    }
  }

  function remap(nextMap: DetectedMap) {
    if (!raw) return
    setMap(nextMap)
    setRows(buildRows(raw, bestRow, nextMap))
  }

  function reset() {
    if (mainChartInst.current) { mainChartInst.current.destroy(); mainChartInst.current = null }
    if (varChartInst.current)  { varChartInst.current.destroy();  varChartInst.current = null }
    setRaw(null); setRows([]); setMap(null); setHeaderRow([]); setBestRow(0); setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---------- Charts ----------
  useEffect(() => {
    if (!rows.length || !mainChartRef.current || !varChartRef.current) return

    const sorted = [...rows].sort((a, b) => b.budget - a.budget)
    const labels = sorted.map(r => r.head.length > 22 ? r.head.slice(0, 22) + '…' : r.head)
    const budgetData = sorted.map(r => toLakh(r.budget))
    const actualData = sorted.map(r => toLakh(r.actual))
    const varData = sorted.map(r => toLakh(r.actual - r.budget))

    if (mainChartInst.current) mainChartInst.current.destroy()
    mainChartInst.current = new Chart(mainChartRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Budget', data: budgetData, backgroundColor: 'rgba(37,99,235,0.85)', borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.7 },
          { label: 'Actual', data: actualData, backgroundColor: 'rgba(245,158,11,0.9)', borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.7 },
        ],
      },
      options: chartOptions('Amount (₹ Lakhs)'),
    })

    if (varChartInst.current) varChartInst.current.destroy()
    varChartInst.current = new Chart(varChartRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Variance (Actual − Budget)',
          data: varData,
          backgroundColor: varData.map(v => v > 0 ? 'rgba(220,38,38,0.85)' : 'rgba(22,163,74,0.85)'),
          borderRadius: 4,
        }],
      },
      options: { ...chartOptions('Variance (₹ Lakhs)'), indexAxis: 'y' },
    })

    return () => {
      mainChartInst.current?.destroy(); mainChartInst.current = null
      varChartInst.current?.destroy();  varChartInst.current = null
    }
  }, [rows])

  // ---------- Derived totals ----------
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0)
  const totalActual = rows.reduce((s, r) => s + r.actual, 0)
  const totalVar = totalActual - totalBudget
  const pctSpent = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0
  const sortedRows = [...rows].sort((a, b) => b.budget - a.budget)

  const hasData = rows.length > 0

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="Budget vs Actual" subtitle="Upload IN4 ERP export — auto-built cost analysis">
        {hasData && (
          <>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            <Button size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> New file
            </Button>
          </>
        )}
      </PageHeader>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {!hasData && (
        <label
          htmlFor="bvaFile"
          className={
            'block bg-white rounded-2xl p-10 border-2 border-dashed text-center cursor-pointer transition ' +
            (dragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/30')
          }
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false)
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0])
          }}
        >
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-3">
            <Upload className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">Upload Budget vs Actual Excel</h2>
          <p className="text-sm text-gray-500 mt-1">Drag &amp; drop your IN4 ERP export, or click to browse · .xlsx / .xls / .csv</p>
          <span className="inline-block mt-4 px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium">Choose file</span>
          <input
            id="bvaFile"
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => { if (e.target.files?.length) handleFile(e.target.files[0]) }}
          />
        </label>
      )}

      {map && (
        <Card className="mb-5">
          <CardContent className="pt-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Detected Columns</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              <Chip>Header row: <b>Row {bestRow + 1}</b></Chip>
              <Chip>Rows found: <b>{rows.length}</b></Chip>
              <Chip>Cost Head: <b>{headerRow[map.head] || 'Col ' + (map.head + 1)}</b></Chip>
              <Chip tone="blue">Budget: <b>{headerRow[map.budget] || 'Col ' + (map.budget + 1)}</b></Chip>
              <Chip tone="amber">Actual: <b>{headerRow[map.actual] || 'Col ' + (map.actual + 1)}</b></Chip>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Cost Head column" value={map.head} headers={headerRow} onChange={v => remap({ ...map, head: v })} />
              <Select label="Budget column"    value={map.budget} headers={headerRow} onChange={v => remap({ ...map, budget: v })} />
              <Select label="Actual column"    value={map.actual} headers={headerRow} onChange={v => remap({ ...map, actual: v })} />
            </div>
          </CardContent>
        </Card>
      )}

      {hasData && (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Kpi accent="blue"  label="Total Budget" value={formatINR(totalBudget)} sub={formatINRFull(totalBudget)} />
            <Kpi accent="amber" label="Total Actual" value={formatINR(totalActual)} sub={formatINRFull(totalActual)} />
            <Kpi
              accent={totalVar > 0 ? 'red' : 'green'}
              label="Variance"
              value={(totalVar > 0 ? '+' : '') + formatINR(totalVar)}
              valueColor={totalVar > 0 ? '#dc2626' : '#16a34a'}
              sub={(totalVar > 0 ? formatINR(Math.abs(totalVar)) + ' over budget' : formatINR(Math.abs(totalVar)) + ' under budget')}
              subColor={totalVar > 0 ? '#dc2626' : '#16a34a'}
            />
            <Kpi accent="indigo" label="% Spent" value={pctSpent.toFixed(1) + '%'} sub={`${rows.length} cost heads tracked`} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5 mb-6">
            <ChartCard title="Budget vs Actual by Cost Head" sub="Side-by-side comparison · values in INR Lakhs">
              <canvas ref={mainChartRef} />
            </ChartCard>
            <ChartCard title="Variance by Cost Head" sub="Red = over budget · Green = under budget">
              <canvas ref={varChartRef} />
            </ChartCard>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="pt-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Detailed Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Cost Head</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Budget</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Actual</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Variance</th>
                      <th className="px-3 py-2.5 font-semibold text-right">% Spent</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r, idx) => {
                      const v = r.actual - r.budget
                      const pct = r.budget > 0 ? (r.actual / r.budget * 100) : 0
                      const status = v > 0 ? 'over' : (v < 0 ? 'under' : 'neutral')
                      const label = v > 0 ? 'Over' : (v < 0 ? 'Under' : 'On track')
                      return (
                        <tr key={idx} className="border-b border-gray-100">
                          <td className="px-3 py-2.5 text-gray-900">{r.head}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(r.budget)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(r.actual)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: v > 0 ? '#dc2626' : (v < 0 ? '#16a34a' : '#475569') }}>
                            {v > 0 ? '+' : ''}{formatINR(v)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{pct.toFixed(1)}%</td>
                          <td className="px-3 py-2.5 text-right"><Pill status={status}>{label}</Pill></td>
                        </tr>
                      )
                    })}
                    <tr className="font-bold bg-gray-50">
                      <td className="px-3 py-3 border-t-2 border-gray-900">TOTAL</td>
                      <td className="px-3 py-3 text-right tabular-nums border-t-2 border-gray-900">{formatINR(totalBudget)}</td>
                      <td className="px-3 py-3 text-right tabular-nums border-t-2 border-gray-900">{formatINR(totalActual)}</td>
                      <td className="px-3 py-3 text-right tabular-nums border-t-2 border-gray-900" style={{ color: totalVar > 0 ? '#dc2626' : '#16a34a' }}>
                        {totalVar > 0 ? '+' : ''}{formatINR(totalVar)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums border-t-2 border-gray-900">{pctSpent.toFixed(1)}%</td>
                      <td className="px-3 py-3 text-right border-t-2 border-gray-900">
                        <Pill status={totalVar > 0 ? 'over' : 'under'}>{totalVar > 0 ? 'Over' : 'Under'}</Pill>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!hasData && (
        <div className="mt-6 text-xs text-gray-400 flex items-center gap-2">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Same formulas as the standalone <code className="font-mono">Budget_vs_Actual_Dashboard.html</code> — variance = Actual − Budget, % Spent = Actual ÷ Budget. Nothing is uploaded to the server; parsing runs entirely in your browser.
        </div>
      )}
    </div>
  )
}

// ---------- Small components ----------

function Kpi({
  label, value, sub, accent, valueColor, subColor,
}: {
  label: string; value: string; sub?: string
  accent: 'blue' | 'amber' | 'red' | 'green' | 'indigo'
  valueColor?: string; subColor?: string
}) {
  const bar: Record<typeof accent, string> = {
    blue: 'bg-blue-600', amber: 'bg-amber-500', red: 'bg-red-600', green: 'bg-green-600', indigo: 'bg-indigo-500',
  }
  return (
    <div className="relative bg-white rounded-2xl p-5 shadow-sm border border-gray-200 overflow-hidden">
      <span className={'absolute left-0 top-0 bottom-0 w-1 ' + bar[accent]} />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-2xl md:text-[26px] font-bold mt-1.5 tracking-tight" style={{ color: valueColor }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: subColor ?? '#475569' }}>{sub}</p>}
    </div>
  )
}

function ChartCard({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-200">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-4">{sub}</p>
      <div className="relative h-[360px]">{children}</div>
    </div>
  )
}

function Chip({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'blue' | 'amber' }) {
  const cls = tone === 'blue' ? 'bg-blue-100 text-blue-800'
    : tone === 'amber' ? 'bg-amber-100 text-amber-800'
    : 'bg-gray-100 text-gray-700'
  return <span className={'inline-flex items-center px-3 py-1 rounded-full text-xs ' + cls}>{children}</span>
}

function Select({
  label, value, headers, onChange,
}: { label: string; value: number; headers: string[]; onChange: (v: number) => void }) {
  return (
    <label className="text-xs text-gray-500 flex flex-col gap-1">
      <span>{label}</span>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900"
      >
        {headers.map((h, i) => (
          <option key={i} value={i}>{h || 'Col ' + (i + 1)}</option>
        ))}
      </select>
    </label>
  )
}

function Pill({ status, children }: { status: 'over' | 'under' | 'neutral'; children: React.ReactNode }) {
  const cls = status === 'over' ? 'bg-red-100 text-red-700'
    : status === 'under' ? 'bg-green-100 text-green-700'
    : 'bg-gray-100 text-gray-600'
  return <span className={'inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ' + cls}>{children}</span>
}

function chartOptions(yLabel: string): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { font: { size: 12, weight: 500 }, usePointStyle: true, pointStyle: 'rectRounded', padding: 14 } },
      tooltip: {
        backgroundColor: '#0f172a', padding: 12, cornerRadius: 8,
        titleFont: { weight: 600 },
        callbacks: {
          label: (ctx: TooltipItem<'bar'>) => {
            const lbl = ctx.dataset.label || ''
            const parsed = ctx.parsed as { x?: number | null; y?: number | null }
            const v = (parsed.y ?? parsed.x ?? 0) as number
            return lbl + ': ₹' + v.toFixed(2) + ' L'
          },
        },
      },
    },
    scales: {
      x: { ticks: { font: { size: 11 }, color: '#64748b' }, grid: { display: false } },
      y: {
        title: { display: true, text: yLabel, font: { size: 11, weight: 500 }, color: '#64748b' },
        ticks: { font: { size: 11 }, color: '#64748b', callback: (v) => '₹' + v + 'L' },
        grid: { color: '#f1f5f9' },
      },
    },
  }
}
