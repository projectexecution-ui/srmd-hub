'use client'
import { useEffect, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'

export type ViewDoc = { name: string | null; url: string | null; ext: string }

type Kind = 'image' | 'pdf' | 'excel' | 'word' | 'other'
function kindOf(ext: string): Kind {
  const e = ext.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(e)) return 'image'
  if (e === 'pdf') return 'pdf'
  if (['xlsx', 'xls', 'csv'].includes(e)) return 'excel'
  if (['doc', 'docx'].includes(e)) return 'word'
  return 'other'
}

export function DocViewer({ doc, onClose }: { doc: ViewDoc; onClose: () => void }) {
  const kind = kindOf(doc.ext)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-gray-200 p-3">
          <span className="truncate text-sm font-semibold text-gray-800">{doc.name || 'Attachment'}</span>
          {doc.url && (
            <a href={doc.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
              <ExternalLink className="h-3.5 w-3.5" /> Open full
            </a>
          )}
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-gray-50">
          {!doc.url ? <Msg text="Preview link unavailable." />
            : kind === 'image' ? <div className="p-3 text-center"><img src={doc.url} alt={doc.name ?? ''} className="mx-auto max-h-[82vh] rounded" /></div>
              : kind === 'pdf' ? <iframe src={doc.url} title="PDF" className="h-[82vh] w-full border-0" />
                : kind === 'excel' ? <ExcelPreview url={doc.url} />
                  : kind === 'word' ? <iframe src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(doc.url)}`} title="Document" className="h-[82vh] w-full border-0" />
                    : <Msg text="This type can't preview inline — use “Open full”." />}
        </div>
      </div>
    </div>
  )
}

function Msg({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-gray-500">{text}</div>
}

function ExcelPreview({ url }: { url: string }) {
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[] | null>(null)
  const [active, setActive] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer()
        const XLSX = await import('xlsx')
        const wb = XLSX.read(buf, { type: 'array' })
        const out = wb.SheetNames.map(name => ({
          name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false }) as unknown[][],
        }))
        if (alive) setSheets(out)
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : 'Could not read this file') }
    })()
    return () => { alive = false }
  }, [url])

  if (err) return <Msg text={err} />
  if (!sheets) return <div className="p-10 text-center text-sm text-gray-500">Loading spreadsheet…</div>
  const s = sheets[active]
  return (
    <div className="p-2">
      {sheets.length > 1 && (
        <div className="mb-2 flex gap-1 overflow-x-auto">
          {sheets.map((sh, i) => (
            <button key={i} onClick={() => setActive(i)}
              className={`shrink-0 rounded px-2.5 py-1 text-xs font-semibold ${i === active ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-600'}`}>{sh.name}</button>
          ))}
        </div>
      )}
      <div className="overflow-auto rounded border border-gray-200 bg-white">
        <table className="min-w-full border-collapse text-xs">
          <tbody>
            {s.rows.slice(0, 300).map((r, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-gray-50 font-semibold' : ''}>
                {(r as unknown[]).map((c, ci) => (
                  <td key={ci} className="whitespace-nowrap border border-gray-100 px-2 py-1 tabular-nums">{c == null ? '' : String(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.rows.length > 300 && <p className="mt-1 text-[11px] text-gray-400">Showing first 300 rows of {s.rows.length}.</p>}
    </div>
  )
}
