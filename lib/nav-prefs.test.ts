import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseOpenMap, readOpenMap, writeOpenMap, readFlag, writeFlag } from './nav-prefs'

describe('parseOpenMap — localStorage is untrusted input', () => {
  it('THE CRASH: the trial stored "1" under the key main uses for an object', () => {
    // `JSON.parse('1')` is 1, a number. The old code then ran `id in 1`, which
    // throws TypeError and took down every page in the hub. It must read as
    // "no preference" instead.
    expect(parseOpenMap('1')).toBeNull()
    expect(parseOpenMap('0')).toBeNull()
  })

  it('reads a genuine open-map', () => {
    expect(parseOpenMap('{"a":true,"b":false}')).toEqual({ a: true, b: false })
  })

  it('rejects every other JSON shape that would not throw on parse', () => {
    expect(parseOpenMap('true')).toBeNull()
    expect(parseOpenMap('"open"')).toBeNull()
    expect(parseOpenMap('null')).toBeNull()
    expect(parseOpenMap('[]')).toBeNull()
    expect(parseOpenMap('[1,2]')).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseOpenMap('{oops')).toBeNull()
    expect(parseOpenMap('undefined')).toBeNull()
  })

  it('treats an empty or absent value as no preference', () => {
    expect(parseOpenMap('')).toBeNull()
    expect(parseOpenMap(null)).toBeNull()
    expect(parseOpenMap(undefined)).toBeNull()
  })

  it('drops non-boolean values rather than letting them through as truthy', () => {
    expect(parseOpenMap('{"a":true,"b":"yes","c":1,"d":null}')).toEqual({ a: true })
  })

  it('an object with no usable keys is still an object, not a failure', () => {
    expect(parseOpenMap('{}')).toEqual({})
    expect(parseOpenMap('{"a":1}')).toEqual({})
  })

  it('the result is always safe for the `in` operator', () => {
    for (const raw of ['1', 'true', '[]', '{oops', 'null', '{"a":true}']) {
      const m = parseOpenMap(raw) ?? {}
      expect(() => 'some-id' in m).not.toThrow()
    }
  })
})

describe('readOpenMap', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    })
  })

  it('returns the stored map', () => {
    store.k = '{"a":true}'
    expect(readOpenMap('k')).toEqual({ a: true })
  })

  it('CLEARS a poisoned key so it stops being re-read every page load', () => {
    store.k = '1'
    expect(readOpenMap('k')).toEqual({})
    expect('k' in store).toBe(false)
  })

  it('leaves an absent key alone', () => {
    expect(readOpenMap('k')).toEqual({})
  })

  it('survives storage that throws — a private window is not a crash', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(readOpenMap('k')).toEqual({})
    expect(() => writeOpenMap('k', { a: true })).not.toThrow()
  })

  it('round-trips through a write', () => {
    writeOpenMap('k', { a: true, b: false })
    expect(readOpenMap('k')).toEqual({ a: true, b: false })
  })
})

describe('readFlag', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    })
  })

  it('reads the two values it writes', () => {
    writeFlag('k', true)
    expect(readFlag('k')).toBe(true)
    writeFlag('k', false)
    expect(readFlag('k')).toBe(false)
  })

  it('is null when nothing is stored, so a caller can keep its default', () => {
    expect(readFlag('k')).toBeNull()
  })

  it('clears a value left by a different version under the same key', () => {
    // The mirror image of the crash: an object where a flag is expected.
    store.k = '{"a":true}'
    expect(readFlag('k')).toBeNull()
    expect('k' in store).toBe(false)
  })

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(readFlag('k')).toBeNull()
    expect(() => writeFlag('k', true)).not.toThrow()
  })
})
