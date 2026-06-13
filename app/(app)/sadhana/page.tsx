import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { SadhanaClientPage } from './SadhanaClientPage'
import type { SadhanaItem, DayStats } from './SadhanaClientPage'

export const dynamic = 'force-dynamic'

const DEFAULT_ITEMS = [
  { name: 'Morning Puja / Prayer',   emoji: '🌅', input_type: 'boolean', unit: null,      target_value: null, sort_order: 1 },
  { name: 'Japa (Mala rounds)',       emoji: '📿', input_type: 'number',  unit: 'rounds',  target_value: 16,   sort_order: 2 },
  { name: 'Meditation',               emoji: '🧘', input_type: 'number',  unit: 'minutes', target_value: 30,   sort_order: 3 },
  { name: 'Scripture Reading',        emoji: '📖', input_type: 'number',  unit: 'minutes', target_value: 20,   sort_order: 4 },
  { name: 'Pranayama',                emoji: '🌬️', input_type: 'number',  unit: 'minutes', target_value: 15,   sort_order: 5 },
  { name: 'Exercise / Yoga',          emoji: '💪', input_type: 'number',  unit: 'minutes', target_value: 30,   sort_order: 6 },
  { name: 'Evening Prayer / Aarti',   emoji: '🕯️', input_type: 'boolean', unit: null,      target_value: null, sort_order: 7 },
  { name: 'Satsang / Discourse',      emoji: '🙌', input_type: 'boolean', unit: null,      target_value: null, sort_order: 8 },
  { name: 'Gratitude Journal',        emoji: '📝', input_type: 'boolean', unit: null,      target_value: null, sort_order: 9 },
  { name: 'Sleep',                    emoji: '😴', input_type: 'number',  unit: 'hours',   target_value: 7,    sort_order: 10 },
] as const

export default async function SadhanaPage() {
  await requirePermission('sadhana', 'view')
  const user = await getMyUser()
  if (!user) return null

  const supabase = await createClient()

  const todayStr = new Date().toISOString().split('T')[0]
  const nineWeeksAgo = new Date(Date.now() - 63 * 86400000).toISOString().split('T')[0]

  // Load (or seed) user's items
  let { data: rawItems } = await supabase
    .from('sadhana_items')
    .select('id, name, emoji, input_type, unit, target_value, sort_order')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('sort_order')

  if (!rawItems || rawItems.length === 0) {
    const { data: seeded } = await supabase
      .from('sadhana_items')
      .insert(DEFAULT_ITEMS.map(item => ({ ...item, user_id: user.id })))
      .select('id, name, emoji, input_type, unit, target_value, sort_order')
    rawItems = seeded ?? []
  }

  const items: SadhanaItem[] = (rawItems ?? []).map(i => ({
    ...i,
    input_type: i.input_type as 'boolean' | 'number',
  }))

  const itemIds = items.map(i => i.id)

  // Today's saved logs
  const { data: todayLogRows } = await supabase
    .from('sadhana_logs')
    .select('item_id, done, value_num')
    .eq('user_id', user.id)
    .eq('log_date', todayStr)
    .in('item_id', itemIds)

  const todayLogs: Record<string, { done: boolean; valueNum: number | null }> = {}
  for (const row of todayLogRows ?? []) {
    todayLogs[row.item_id] = { done: row.done, valueNum: row.value_num as number | null }
  }

  // Last 9 weeks of logs for heatmap + streak
  const { data: recentLogs } = await supabase
    .from('sadhana_logs')
    .select('log_date, done, value_num')
    .eq('user_id', user.id)
    .gte('log_date', nineWeeksAgo)
    .in('item_id', itemIds)

  // Aggregate per day
  const dayMap = new Map<string, { done: number; total: number }>()
  for (const log of recentLogs ?? []) {
    const s = dayMap.get(log.log_date) ?? { done: 0, total: 0 }
    s.total++
    if (log.done || (log.value_num as number | null ?? 0) > 0) s.done++
    dayMap.set(log.log_date, s)
  }

  const dayStats: DayStats[] = Array.from(dayMap.entries()).map(([date, s]) => ({
    date, done: s.done, total: s.total,
  }))

  function streakEndingOn(date: string): number {
    let count = 0
    let d = date
    while (true) {
      const s = dayMap.get(d)
      if (!s || s.total === 0 || s.done / s.total < 0.5) break
      count++
      const prev = new Date(d + 'T00:00:00')
      prev.setDate(prev.getDate() - 1)
      d = prev.toISOString().split('T')[0]
      if (d < nineWeeksAgo) break
    }
    return count
  }

  const streak = streakEndingOn(todayStr)
  const bestStreak = Math.max(streak, ...Array.from(dayMap.keys()).map(streakEndingOn))

  const subtitleDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <PageHeader title="Daily Sadhana" subtitle={subtitleDate} />
      <SadhanaClientPage
        items={items}
        todayLogs={todayLogs}
        dayStats={dayStats}
        todayStr={todayStr}
        streak={streak}
        bestStreak={bestStreak}
      />
    </div>
  )
}
