'use client'
import { useMemo, useState } from 'react'
import { ShieldAlert, ChevronDown, ChevronRight, PackageX, IndianRupee, HelpCircle } from 'lucide-react'
import type { LineRecord } from '@/lib/procurement'
import { shortIndent } from '@/lib/procurement/shared'

// "Data health" — the app self-reporting what IN4 did NOT hand over cleanly,
// so nothing is silently hidden or shown as a fake ₹0. Everything here is
// derived live from the current data (no re-upload needed). Collapsed by
// default; hidden entirely when there's nothing to flag.
//
//  1. PO raised but NO quantity in the export → these would otherwise vanish
//     (pending qty computes to 0, so they fall out of every view).
//  2. On order but NO rate in the export → value can't be computed; shown as
//     "value TBD" rather than ₹0 so the pending total isn't understated.
//  3. Suspect project code → the indent number's code isn't a known project
//     (e.g. a typo'd "ND"/"DA"), so it's grouped under the raw code.

type Group = { key: string; label: string; hint: string; icon: React.ReactNode; items: LineRecord[] }

export function DataHealth({ lines, onPick }: { lines: LineRecord[]; onPick: (l: LineRecord) => void }) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<string | null>(null)

  const groups = useMemo<Group[]>(() => {
    const qtyMissing = lines.filter(l => l.pos.length > 0 && (l.orderedQty ?? 0) === 0)
    const valueUnknown = lines.filter(
      l => (l.status === 'pending' || l.status === 'partial') && l.pendingQty > 0 && (l.pendingValue ?? 0) === 0,
    )
    const suspectProject = lines.filter(l => /^[A-Z0-9]{2,5}$/.test(l.project || ''))
    return [
      { key: 'qty', label: 'PO raised, quantity missing in export', hint: 'A PO exists but IN4 sent no order qty — verify the quantity in IN4. Without this fix they would be invisible.', icon: <PackageX className="h-4 w-4" />, items: qtyMissing },
      { key: 'val', label: 'On order, value not in this export', hint: 'These are genuinely pending, but this report carries no rate — value shows as TBD, not ₹0. Upload the PO report to price them.', icon: <IndianRupee className="h-4 w-4" />, items: valueUnknown },
      { key: 'proj', label: 'Suspect project code', hint: 'The indent number’s project code isn’t a known project (likely a typo in IN4), so it’s grouped under the raw code.', icon: <HelpCircle className="h-4 w-4" />, items: suspectProject },
    ].filter(g => g.items.length > 0)
  }, [lines])

  const total = groups.reduce((s, g) => s + g.items.length, 0)
  if (total === 0) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-50 transition-colors"
      >
        <ShieldAlert className="h-4 w-4 text-amber-700 flex-shrink-0" />
        <span className="text-sm font-semibold text-amber-900">
          Data health — {total} item{total === 1 ? '' : 's'} IN4 didn’t hand over cleanly
        </span>
        <span className="ml-auto text-amber-700">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {groups.map(g => {
            const expanded = section === g.key
            return (
              <div key={g.key} className="rounded-lg border border-amber-200 bg-white">
                <button
                  type="button"
                  onClick={() => setSection(expanded ? null : g.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                >
                  <span className="text-amber-700">{g.icon}</span>
                  <span className="text-sm font-medium text-stone-800">{g.label}</span>
                  <span className="text-xs font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">{g.items.length}</span>
                  <span className="ml-auto text-stone-400">
                    {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </span>
                </button>
                {expanded && (
                  <div className="px-3 pb-2">
                    <p className="text-[11px] text-stone-500 mb-1.5">{g.hint}</p>
                    <ul className="max-h-64 overflow-y-auto divide-y divide-stone-100 rounded-md border border-stone-100">
                      {g.items.slice(0, 40).map(l => (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => onPick(l)}
                            className="w-full text-left px-2.5 py-1.5 hover:bg-amber-50/70 transition-colors"
                          >
                            <div className="text-xs font-medium text-stone-900 truncate">{l.material || '—'}</div>
                            <div className="text-[11px] text-stone-500 truncate">
                              <span className="font-mono">{shortIndent(l.indentNo)}</span> · {l.project}
                              {l.pos[0]?.poNo ? ` · ${shortIndent(l.pos[0].poNo)}` : ''}
                              {l.pendingQty > 0 ? ` · ${l.pendingQty} ${l.uom || ''} pending` : ''}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {g.items.length > 40 && (
                      <p className="text-[11px] text-stone-400 mt-1">+ {g.items.length - 40} more</p>
                    )}
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
