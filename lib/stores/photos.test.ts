import { describe, it, expect } from 'vitest'
import {
  GATE_SLOTS, ISSUE_SLOTS, storekeeperSlots, missingPhotos, photoPath,
} from './photos'

describe('the photographs the mind map asks for', () => {
  it('asks Security for the papers, and will not let it be skipped', () => {
    expect(GATE_SLOTS.map(s => s.kind)).toEqual(['challan'])
    expect(GATE_SLOTS.every(s => s.required)).toBe(true)
  })

  it('asks the storekeeper for the material AND the place it was put', () => {
    // "Item Pics" and "Storage Location Pics", both named in the map.
    expect(storekeeperSlots(true).map(s => s.kind)).toEqual(['item', 'location'])
    expect(storekeeperSlots(true).every(s => s.required)).toBe(true)
  })

  it('does not ask a vendor delivery where it was stored — it never is', () => {
    // Vendor material goes straight to site, so there is no storage place to
    // photograph and demanding one would block a legitimate entry for ever.
    expect(storekeeperSlots(false).map(s => s.kind)).toEqual(['item'])
  })

  it('asks for the material going out AND the video of the load', () => {
    const byKind = Object.fromEntries(ISSUE_SLOTS.map(s => [s.kind, s]))
    expect(byKind.item.required).toBe(true)
    expect(byKind.video.video).toBe(true)
    // Compulsory since 15 Sep 2026. It was optional only because nobody holds
    // the security role, and Aksha removed that obstacle rather than the
    // requirement: "else the store keeper to take a video if security
    // unavailabel". With a fallback taker there is nobody left to block on.
    expect(byKind.video.required).toBe(true)
  })
})

describe('missingPhotos', () => {
  it('names what is still needed, in the words on screen', () => {
    expect(missingPhotos(storekeeperSlots(true), {})).toEqual([
      'Photo of the material', 'Photo of where you put it',
    ])
  })

  it('goes quiet once each required slot has one', () => {
    expect(missingPhotos(storekeeperSlots(true), { item: 1, location: 1 })).toEqual([])
  })

  it('counts one as enough — the map asks for a photo, not a number of them', () => {
    expect(missingPhotos(storekeeperSlots(true), { item: 3, location: 1 })).toEqual([])
  })

  it('holds an issue until BOTH the photo and the video are there', () => {
    expect(missingPhotos(ISSUE_SLOTS, {})).toEqual(['Photo of the material going out', 'Video of the load'])
    expect(missingPhotos(ISSUE_SLOTS, { item: 1 })).toEqual(['Video of the load'])
    expect(missingPhotos(ISSUE_SLOTS, { item: 1, video: 1 })).toEqual([])
  })

  it('still never blocks on a slot that is marked optional', () => {
    const optional = [{ kind: 'other' as const, label: 'Anything else', hint: '', required: false }]
    expect(missingPhotos(optional, {})).toEqual([])
  })
})

describe('photoPath', () => {
  it('files a photo under its entry and kind', () => {
    const p = photoPath('abc-123', 'item', 'IMG_0042.jpg')
    expect(p.startsWith('entries/abc-123/item/')).toBe(true)
    expect(p.endsWith('img-0042.jpg')).toBe(true)
  })

  it('will not let a filename escape the folder or break the key', () => {
    const p = photoPath('e1', 'challan', '../../etc/passwd')
    expect(p).not.toContain('..')
    expect(p.startsWith('entries/e1/challan/')).toBe(true)
    expect(p.endsWith('.jpg')).toBe(true)
  })

  it('refuses an extension nobody should be storing here', () => {
    expect(photoPath('e1', 'item', 'payload.svg')).toMatch(/.jpg$/)
    expect(photoPath('e1', 'item', 'payload.html')).toMatch(/.jpg$/)
    expect(photoPath('e1', 'video', 'clip.mp4')).toMatch(/.mp4$/)
  })

  it('still produces a usable key when the name is nothing but punctuation', () => {
    expect(photoPath('e1', 'item', '...')).toContain('photo.jpg')
  })

  it('keeps the tail of a very long name rather than the head', () => {
    // The end of a camera filename is what distinguishes two shots.
    const p = photoPath('e1', 'item', 'x'.repeat(200) + 'END.jpg')
    expect(p).toContain('end.jpg')
    expect(p.length).toBeLessThan(120)
  })
})
