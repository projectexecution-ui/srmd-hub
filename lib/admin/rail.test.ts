import { describe, it, expect } from 'vitest'
import { railBadge, foldToday, type RailCounts } from './rail'

const quiet: RailCounts = { people: 13, pendingAccess: 0, projects: 58, projectsNeedHead: 0, scheduled: 12, messagesSilent: 0, feeds: 8, feedsFailing: 0, feedsUnfinished: 0, intakeWaiting: 0, modulesOn: 12, modulesTotal: 14 }

describe('railBadge — what is wrong if anything is, else what is there', () => {
  it('a quiet hub reads as plain counts', () => {
    expect(railBadge('people', quiet)).toEqual({ text: '13 people', tone: 'none' })
    expect(railBadge('projects', quiet)).toEqual({ text: '58 projects', tone: 'none' })
    expect(railBadge('messages', quiet)).toEqual({ text: '12 scheduled', tone: 'none' })
    expect(railBadge('data', quiet)).toEqual({ text: '8 feeds ok', tone: 'ok' })
    expect(railBadge('hub', quiet)).toEqual({ text: '12 / 14 on', tone: 'none' })
  })
  it('this morning: 20 RU projects without a head, the tracker feed failing, 67 waiting from IN4', () => {
    const c = { ...quiet, pendingAccess: 2, projectsNeedHead: 20, feedsFailing: 1, intakeWaiting: 67 }
    expect(railBadge('people', c)).toEqual({ text: '2 waiting', tone: 'warn' })
    expect(railBadge('projects', c)).toEqual({ text: '20 need a head', tone: 'warn' })
    expect(railBadge('data', c)).toEqual({ text: '1 feed failing', tone: 'bad' })
  })
  it('data: failing beats unfinished beats waiting beats ok; singulars are right', () => {
    expect(railBadge('data', { ...quiet, feedsUnfinished: 1 })).toEqual({ text: '1 feed unfinished', tone: 'warn' })
    expect(railBadge('data', { ...quiet, intakeWaiting: 3 })).toEqual({ text: '3 waiting from IN4', tone: 'none' })
    expect(railBadge('projects', { ...quiet, projectsNeedHead: 1 })).toEqual({ text: '1 needs a head', tone: 'warn' })
    expect(railBadge('messages', { ...quiet, messagesSilent: 2 })).toEqual({ text: '2 reach nobody', tone: 'bad' })
  })
})

describe('foldToday — the one-line ribbon', () => {
  it('nothing → a green sentence', () => {
    expect(foldToday([])).toEqual({ count: 0, tone: 'ok', line: 'Nothing needs you today.' })
  })
  it('three things: the first clause of each, the worst tone', () => {
    const f = foldToday([
      { id: 'a', tone: 'bad', text: 'The Indent → PO tracker feed failed at 22 Sep 2026, 17:12 — statement timeout.', href: '#', action: 'x' },
      { id: 'b', tone: 'warn', text: '20 people are waiting for access to the hub.', href: '#', action: 'x' },
      { id: 'c', tone: 'info', text: '3 roles are set up but nobody holds them. The grid carries them.', href: '#', action: 'x' },
    ])
    expect(f.count).toBe(3)
    expect(f.tone).toBe('bad')
    expect(f.line).toBe('3 things need you · The Indent → PO tracker feed failed at 22 Sep 2026, 17:12 · 20 people are waiting for access to the hub · 3 roles are set up but nobody holds them')
  })
  it('more than three is counted, not listed; one thing reads in the singular', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i), tone: 'warn' as const, text: `Thing ${i}.`, href: '#', action: 'x' }))
    expect(foldToday(rows).line).toBe('5 things need you · Thing 0 · Thing 1 · Thing 2 · +2 more')
    expect(foldToday(rows.slice(0, 1)).line).toBe('1 thing needs you · Thing 0')
  })
})
