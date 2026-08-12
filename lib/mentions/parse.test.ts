import { describe, it, expect } from 'vitest'
import { splitMentions, activeMentionIds, mentionToken } from './parse'

const USERS = [
  { id: 'u1', name: 'Parimal Srmd' },
  { id: 'u2', name: 'Parimal' },
  { id: 'u3', name: 'Akshay Atmarpit' },
]

describe('splitMentions', () => {
  it('highlights a known @name and keeps the surrounding text', () => {
    const segs = splitMentions('Hey @Parimal Srmd please enter in IN4', USERS)
    expect(segs).toEqual([
      { type: 'text', value: 'Hey ' },
      { type: 'mention', value: '@Parimal Srmd', id: 'u1' },
      { type: 'text', value: ' please enter in IN4' },
    ])
  })

  it('prefers the longest matching name (Parimal Srmd over Parimal)', () => {
    const segs = splitMentions('@Parimal Srmd', USERS)
    expect(segs.filter(s => s.type === 'mention')).toEqual([{ type: 'mention', value: '@Parimal Srmd', id: 'u1' }])
  })

  it('handles two mentions in one line', () => {
    const segs = splitMentions('@Akshay Atmarpit and @Parimal look here', USERS)
    const mentions = segs.filter(s => s.type === 'mention').map(s => s.value)
    expect(mentions).toEqual(['@Akshay Atmarpit', '@Parimal'])
  })

  it('leaves plain text (and unknown @names) untouched', () => {
    expect(splitMentions('no mentions here', USERS)).toEqual([{ type: 'text', value: 'no mentions here' }])
    expect(splitMentions('@Nobody at all', USERS)).toEqual([{ type: 'text', value: '@Nobody at all' }])
  })

  it('is safe with regex-special characters in the text', () => {
    const segs = splitMentions('cost (a+b)? ask @Parimal', USERS)
    expect(segs.some(s => s.type === 'mention' && s.value === '@Parimal')).toBe(true)
  })
})

describe('activeMentionIds', () => {
  it('returns only picked users still present in the text, deduped', () => {
    const picked = [{ id: 'u1', name: 'Parimal Srmd' }, { id: 'u3', name: 'Akshay Atmarpit' }]
    expect(activeMentionIds('ping @Parimal Srmd again @Parimal Srmd', picked)).toEqual(['u1'])
    expect(activeMentionIds('nobody', picked)).toEqual([])
  })
})

describe('mentionToken', () => {
  it('inserts "@Name " with a trailing space', () => {
    expect(mentionToken('Parimal Srmd')).toBe('@Parimal Srmd ')
  })
})
