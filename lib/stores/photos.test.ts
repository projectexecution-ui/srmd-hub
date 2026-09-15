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

  it('asks for the material going out, and leaves the video optional', () => {
    const byKind = Object.fromEntries(ISSUE_SLOTS.map(s => [s.kind, s]))
    expect(byKind.item.required).toBe(true)
    // Nobody holds the `security` role yet; requiring their video would stop
    // every issue until accounts exist.
    expect(byKind.video.required).toBe(false)
    expect(byKind.video.video).toBe(true)
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

  it('never blocks on an optional slot', () => {
    expect(missingPhotos(ISSUE_SLOTS, { item: 1 })).toEqual([])
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
