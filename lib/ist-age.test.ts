import { describe, expect, it, vi, afterEach } from 'vitest'
import { istCalendarDaysAgo, istAgeLabel } from './utils'

/** Freeze "now" at a known IST instant. 22 Aug 2026, 07:00 IST = 01:30 UTC. */
function nowIST(iso: string) { vi.setSystemTime(new Date(iso)) }
afterEach(() => vi.useRealTimers())

describe('istCalendarDaysAgo', () => {
  it('THE REPORTED BUG: an upload at 3:49 pm yesterday is 1 day ago, not 0', () => {
    vi.useFakeTimers(); nowIST('2026-08-22T01:30:00Z')          // 22 Aug, 07:00 IST
    const upload = '2026-08-21T10:19:00Z'                       // 21 Aug, 15:49 IST
    // elapsed is only ~15h, so the old ms/24h maths gave 0 => "today"
    expect(Math.floor((Date.parse('2026-08-22T01:30:00Z') - Date.parse(upload)) / 86_400_000)).toBe(0)
    // the calendar answer is 1 => "yesterday"
    expect(istCalendarDaysAgo(upload)).toBe(1)
    expect(istAgeLabel(upload).text).toBe('yesterday')
  })

  it('same IST calendar day reads as today, even 20 hours apart', () => {
    vi.useFakeTimers(); nowIST('2026-08-22T18:25:00Z')          // 22 Aug, 23:55 IST
    expect(istAgeLabel('2026-08-21T22:35:00Z').text).toBe('today')   // 22 Aug, 04:05 IST
  })

  it('does not drift across the IST midnight boundary', () => {
    vi.useFakeTimers(); nowIST('2026-08-21T18:35:00Z')          // 22 Aug, 00:05 IST
    // 21 Aug 23:55 IST — five minutes earlier, but the previous IST day
    expect(istAgeLabel('2026-08-21T18:25:00Z').text).toBe('yesterday')
  })

  it('counts real gaps and phrases them', () => {
    vi.useFakeTimers(); nowIST('2026-08-22T01:30:00Z')
    expect(istCalendarDaysAgo('2026-08-19T10:00:00Z')).toBe(3)
    expect(istAgeLabel('2026-08-19T10:00:00Z').text).toBe('3 days ago')
    expect(istAgeLabel('2026-08-19T10:00:00Z', { short: true }).text).toBe('3 d ago')
    expect(istAgeLabel('2026-08-05T10:00:00Z').text).toBe('2 weeks ago')
    expect(istAgeLabel('2026-06-05T10:00:00Z').text).toBe('2 months ago')
  })

  it('the 14-day stale flag now flips on the right day', () => {
    vi.useFakeTimers(); nowIST('2026-08-22T01:30:00Z')
    // Note: pick MORNING UTC times here. 2026-08-08T20:00Z is already 9 Aug in
    // IST, which is what made the first version of this expectation wrong.
    expect(istCalendarDaysAgo('2026-08-08T04:00:00Z')).toBe(14)   // 8 Aug IST — stale
    expect(istCalendarDaysAgo('2026-08-09T04:00:00Z')).toBe(13)   // 9 Aug IST — not yet
  })

  it('handles null and rubbish without throwing', () => {
    expect(istCalendarDaysAgo(null)).toBeNull()
    expect(istCalendarDaysAgo('not a date')).toBeNull()
    expect(istAgeLabel(null).text).toBe('unknown')
  })
})
