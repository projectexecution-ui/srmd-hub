'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Building2, Landmark, Layers } from 'lucide-react'
import { StagePill } from './StagePill'
import type { BbStage } from '@/lib/bills-booking/stages'

export type Leaf = {
  id: string; vendor: string; billNo: string | null; orderType: string
  billType: string | null; discipline: string | null; stage: BbStage; amount: number
}
export type SubNode = { key: string; label: string; n: number; value: number; bills: Leaf[] }
export type MainNode = { key: string; label: string; n: number; value: number; subs: SubNode[] }
export type TrustNode = { key: string; label: string; n: number; value: number; mains: MainNode[] }

const cr = (n: number) => {
  const v = Number(n || 0)
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr'
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + v.toLocaleString('en-IN')
}

function useOpen(initial = false) {
  const [open, setOpen] = useState(initial)
  return { open, toggle: () => setOpen(o => !o) }
}

function Agg({ n, value }: { n: number; value: number }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums text-gray-500">
      <span>{n} bill{n === 1 ? '' : 's'}</span>
      <span className="font-bold text-gray-800">{cr(value)}</span>
    </span>
  )
}
function Chevron({ open }: { open: boolean }) {
  return <ChevronRight className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
}

export function BillingTree({ tree }: { tree: TrustNode[] }) {
  return (
    <div className="space-y-2">
      {tree.map(t => <Trust key={t.key} t={t} />)}
    </div>
  )
}

function Trust({ t }: { t: TrustNode }) {
  const { open, toggle } = useOpen(true)
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <button onClick={toggle} className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-gray-50">
        <Chevron open={open} />
        <Landmark className="h-4 w-4 shrink-0 text-indigo-600" />
        <span className="truncate text-[15px] font-bold text-gray-900">{t.label}</span>
        <Agg n={t.n} value={t.value} />
      </button>
      {open && (
        <div className="border-t border-gray-100 pl-3">
          {t.mains.map(m => <Main key={m.key} m={m} />)}
        </div>
      )}
    </div>
  )
}

function Main({ m }: { m: MainNode }) {
  const { open, toggle } = useOpen(false)
  return (
    <div className="border-b border-gray-50 last:border-0">
      <button onClick={toggle} className="flex w-full items-center gap-2.5 py-2.5 pl-3 pr-4 text-left hover:bg-gray-50">
        <Chevron open={open} />
        <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="truncate text-sm font-semibold text-gray-800">{m.label}</span>
        <Agg n={m.n} value={m.value} />
      </button>
      {open && (
        <div className="pl-5">
          {m.subs.map(s => <Sub key={s.key} s={s} />)}
        </div>
      )}
    </div>
  )
}

function Sub({ s }: { s: SubNode }) {
  const direct = s.key === '__direct__'
  const { open, toggle } = useOpen(direct) // "Direct" bills open by default
  return (
    <div className="border-b border-gray-50 last:border-0">
      <button onClick={toggle} className="flex w-full items-center gap-2.5 py-2 pl-3 pr-4 text-left hover:bg-gray-50">
        <Chevron open={open} />
        <Layers className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <span className={`truncate text-[13px] ${direct ? 'italic text-gray-500' : 'font-medium text-gray-700'}`}>{s.label}</span>
        <Agg n={s.n} value={s.value} />
      </button>
      {open && (
        <ul className="pb-1 pl-5">
          {s.bills.map(b => (
            <li key={b.id}>
              <Link href={`/bills-booking/${b.id}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-indigo-50/50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-gray-900">{b.vendor}</span>
                    <span className="rounded border border-gray-200 px-1 py-px text-[10px] font-semibold text-gray-500">{b.orderType}</span>
                    {b.billType && <span className="rounded bg-indigo-50 px-1 py-px text-[10px] font-semibold text-indigo-700">{b.billType}</span>}
                    {b.discipline && <span className="rounded bg-gray-100 px-1 py-px text-[10px] font-semibold text-gray-600">{b.discipline}</span>}
                  </div>
                  <span className="text-[11px] text-gray-400">Bill {b.billNo || '—'}</span>
                </div>
                <span className="text-[13px] font-bold tabular-nums text-gray-900">₹{b.amount.toLocaleString('en-IN')}</span>
                <StagePill stage={b.stage} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
