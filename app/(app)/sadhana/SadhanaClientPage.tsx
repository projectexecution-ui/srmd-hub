'use client'

import { useState, useTransition } from 'react'
import { Check } from 'lucide-react'
import { saveDailyEntry } from './actions'

export type SadhanaItem = {
  id: string
  name: string
  emoji: string
  input_type: 'boolean' | 'number'
  unit: string | null
  target_value: number | null
  sort_order: number
}

export type DayStats = {
  date: string
  done: number
  total: number
}

type Props = {
  items: SadhanaItem[]
  todayLogs: Record<string, { done: boolean; valueNum: number | null }>
  dayStats: DayStats[]
  todayStr: string
  streak: number
  bestStreak: number
}

export function SadhanaClientPage({ items, todayLogs, dayStats, todayStr, streak, bestStreak }: Props) {
  const [entries, setEntries] = useState<Record<string, { done: boolean; valueNum: number | null }>>(() => {
    const init: Record<string, { done: boolean; valueNum: number | null }> = {}
    for (const item of items) {
      init[item.id] = todayLogs[item.id] ?? { done: false, valueNum: null }
    }
    return init
  })

  const [isPending, startTransition] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const completedCount = items.filter(item => {
    const e = entries[item.id]
    if (!e) return false
    return item.input_type === 'boolean' ? e.done : (e.valueNum ?? 0) > 0
  }).length
  const totalCount = items.length
  const completionPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  type EntryMap = Record<string, { done: boolean; valueNum: number | null }>

  function toggleBoolean(itemId: string) {
    setEntries((prev: EntryMap) => ({ ...prev, [itemId]: { done: !prev[itemId]?.done, valueNum: null } }))
    setSaveStatus('idle')
  }

  function setNumber(itemId: string, val: number) {
    const v = Math.max(0, val)
    setEntries((prev: EntryMap) => ({ ...prev, [itemId]: { done: v > 0, valueNum: v } }))
    setSaveStatus('idle')
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveDailyEntry(
        todayStr,
        items.map(item => ({
          itemId: item.id,
          done: entries[item.id]?.done ?? false,
          valueNum: entries[item.id]?.valueNum ?? null,
        }))
      )
      if (result.ok) {
        setSaveStatus('saved')
      } else {
        setSaveStatus('error')
        setErrorMsg(result.error)
      }
    })
  }

  const displayDate = new Date(todayStr + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          value={`${completionPct}%`}
          label="Today"
          sub={`${completedCount}/${totalCount} done`}
          bg="bg-amber-50"
          border="border-amber-200"
          text="text-amber-700"
          sub2="text-amber-600"
        />
        <StatCard
          value={`🔥 ${streak}`}
          label="Day streak"
          bg="bg-orange-50"
          border="border-orange-200"
          text="text-orange-700"
          sub2="text-orange-600"
        />
        <StatCard
          value={`⭐ ${bestStreak}`}
          label="Best streak"
          bg="bg-purple-50"
          border="border-purple-200"
          text="text-purple-700"
          sub2="text-purple-600"
        />
      </div>

      {/* Today's entry */}
      <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Today&apos;s Entry</h2>
          <span className="text-xs text-gray-400">{displayDate}</span>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-gray-100 rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-700"
            style={{ width: `${completionPct}%` }}
          />
        </div>

        {/* Items */}
        <div className="space-y-2">
          {items.map(item => {
            const entry = entries[item.id] ?? { done: false, valueNum: null }
            const isDone = item.input_type === 'boolean' ? entry.done : (entry.valueNum ?? 0) > 0

            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  isDone ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100 hover:border-gray-200'
                }`}
              >
                <span className="text-xl w-8 text-center flex-shrink-0">{item.emoji}</span>
                <span className={`flex-1 text-sm font-medium ${isDone ? 'text-amber-900' : 'text-gray-700'}`}>
                  {item.name}
                  {item.target_value && item.unit && (
                    <span className="ml-1 text-xs text-gray-400 font-normal">
                      (target: {item.target_value} {item.unit})
                    </span>
                  )}
                </span>

                {item.input_type === 'boolean' ? (
                  <button
                    onClick={() => toggleBoolean(item.id)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                      entry.done
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-300 hover:bg-gray-200'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setNumber(item.id, (entry.valueNum ?? 0) - (item.unit === 'hours' ? 0.5 : item.unit === 'minutes' ? 5 : 1))}
                      className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-base leading-none"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      step={item.unit === 'hours' ? 0.5 : item.unit === 'minutes' ? 5 : 1}
                      value={entry.valueNum ?? ''}
                      onChange={e => setNumber(item.id, Number(e.target.value))}
                      className="w-14 h-7 text-center text-sm font-semibold border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-amber-400"
                      placeholder="0"
                    />
                    <button
                      onClick={() => setNumber(item.id, (entry.valueNum ?? 0) + (item.unit === 'hours' ? 0.5 : item.unit === 'minutes' ? 5 : 1))}
                      className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-base leading-none"
                    >
                      +
                    </button>
                    {item.unit && (
                      <span className="text-xs text-gray-400 w-10 truncate">{item.unit}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Save */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-sm hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 transition-all shadow-sm active:scale-[0.98]"
          >
            {isPending ? 'Saving…' : 'Save Today\'s Entry'}
          </button>
          {saveStatus === 'saved' && (
            <span className="text-sm text-green-600 font-medium whitespace-nowrap">✓ Saved!</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-xs text-red-600 max-w-[120px] leading-tight">{errorMsg}</span>
          )}
        </div>
      </div>

      {/* Heatmap */}
      <SadhanaHeatmap dayStats={dayStats} todayStr={todayStr} />
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  value, label, sub, bg, border, text, sub2,
}: {
  value: string; label: string; sub?: string
  bg: string; border: string; text: string; sub2: string
}) {
  return (
    <div className={`${bg} border ${border} rounded-2xl p-3 text-center`}>
      <div className={`text-xl font-bold ${text} leading-tight`}>{value}</div>
      <div className={`text-xs ${sub2} mt-0.5`}>{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────

function cellBg(pct: number | null): string {
  if (pct === null) return 'bg-gray-100'
  if (pct >= 80) return 'bg-amber-600'
  if (pct >= 60) return 'bg-amber-400'
  if (pct >= 40) return 'bg-amber-300'
  if (pct >= 20) return 'bg-amber-200'
  return 'bg-amber-100'
}

function SadhanaHeatmap({ dayStats, todayStr }: { dayStats: DayStats[]; todayStr: string }) {
  const statsMap = new Map(dayStats.map(d => [d.date, d]))

  // Build last 63 days (9 × 7)
  const DAYS = 63
  const cells: { date: string; pct: number | null }[] = []
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(todayStr + 'T00:00:00')
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const s = statsMap.get(dateStr)
    cells.push({ date: dateStr, pct: s && s.total > 0 ? (s.done / s.total) * 100 : null })
  }

  // Pad front to start on Sunday
  const startDow = new Date(cells[0].date + 'T00:00:00').getDay()
  const padded: ({ date: string; pct: number | null } | null)[] = [
    ...Array<null>(startDow).fill(null),
    ...cells,
  ]

  const weeks: ({ date: string; pct: number | null } | null)[][] = []
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7))
  }

  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <h2 className="font-semibold text-gray-800 mb-3">Last 9 Weeks</h2>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {DOW.map((d, i) => (
          <div key={i} className="text-center text-[10px] text-gray-400 font-medium">{d}</div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
          {week.map((day, di) =>
            day === null ? (
              <div key={di} className="aspect-square" />
            ) : (
              <div
                key={day.date}
                title={`${day.date}${day.pct !== null ? ` · ${Math.round(day.pct)}%` : ' · no entry'}`}
                className={`aspect-square rounded-sm ${cellBg(day.pct)} ${
                  day.date === todayStr
                    ? 'ring-2 ring-orange-500 ring-offset-1'
                    : ''
                }`}
              />
            )
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 mt-3 text-[11px] text-gray-400">
        <span>Less</span>
        {(['bg-gray-100', 'bg-amber-100', 'bg-amber-200', 'bg-amber-300', 'bg-amber-400', 'bg-amber-600'] as const).map((c, i) => (
          <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
