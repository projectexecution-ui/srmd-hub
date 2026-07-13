'use client'
// Scannable executive brief behind a header icon — headline numbers +
// short bulleted sections, computed from the board data (no wall of text).

import { useState } from 'react'
import { formatINRShort } from '@/lib/jmr/format'
import { Sparkles, X, Star } from 'lucide-react'

export interface BriefData {
  date: string
  toAction: number
  blocked: number
  overdue: number
  waiting: number
  doFirst: { subject: string; sender: string; vip: boolean; amount: number | null; age: number | null }[]
  thisWeek: string[]
  thisWeekCount: number
  waitingItems: { subject: string; sender: string; overdue: boolean }[]
}

export function BriefButton({ data }: { data: BriefData }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Your brief"
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white text-teal-700 ring-1 ring-teal-200 hover:bg-teal-50 transition"
      >
        <Sparkles className="h-3.5 w-3.5" /> Brief
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 z-30 w-[min(92vw,460px)] bg-white rounded-2xl shadow-xl ring-1 ring-gray-200 p-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-2.5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700/80">Your brief</p>
              <p className="text-[11px] text-gray-400">{data.date}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>

          {/* Headline chips */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Chip cls="bg-rose-50 text-rose-700">{data.toAction} to action</Chip>
            {data.blocked > 0 && <Chip cls="bg-rose-50 text-rose-700">{formatINRShort(data.blocked)} blocked</Chip>}
            {data.overdue > 0 && <Chip cls="bg-rose-100 text-rose-800">{data.overdue} overdue</Chip>}
            {data.waiting > 0 && <Chip cls="bg-blue-50 text-blue-700">{data.waiting} waiting</Chip>}
          </div>

          {/* Do first */}
          {data.doFirst.length > 0 && (
            <Section title="Do first" dot="bg-rose-500">
              {data.doFirst.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-gray-300 mt-0.5">•</span>
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-gray-900">{r.subject}</span>
                    <span className="text-[11px] text-gray-400">
                      {' '}— {r.sender}
                      {r.vip && <Star className="inline h-3 w-3 text-amber-400 ml-0.5 -mt-0.5" fill="currentColor" />}
                      {typeof r.age === 'number' ? ` · ${r.age}d` : ''}
                      {r.amount ? ` · ${formatINRShort(r.amount)}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </Section>
          )}

          {/* This week */}
          {data.thisWeekCount > 0 && (
            <Section title={`This week · ${data.thisWeekCount}`} dot="bg-amber-500">
              {data.thisWeek.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-gray-300 mt-0.5">•</span>
                  <span className="text-[13px] text-gray-800">{s}</span>
                </li>
              ))}
              {data.thisWeekCount > data.thisWeek.length && (
                <li className="text-[11px] text-gray-400 pl-4">+{data.thisWeekCount - data.thisWeek.length} more</li>
              )}
            </Section>
          )}

          {/* Waiting on others */}
          {data.waitingItems.length > 0 && (
            <Section title={`Waiting on others · ${data.waiting}`} dot="bg-blue-500">
              {data.waitingItems.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-gray-300 mt-0.5">•</span>
                  <div className="min-w-0">
                    <span className="text-[13px] text-gray-800">{r.subject}</span>
                    <span className={`text-[11px] ${r.overdue ? 'text-rose-600 font-medium' : 'text-gray-400'}`}> — {r.sender}{r.overdue ? ' · overdue' : ''}</span>
                  </div>
                </li>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{children}</span>
}

function Section({ title, dot, children }: { title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{title}</span>
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}
