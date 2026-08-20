import { describe, expect, it } from 'vitest'
import {
  homeTiles, homeCallout, canStoreFor, MAX_SUBTITLE_WORDS, NEEDS_EDIT, NEEDS_ADMIN,
} from './home'
import type { HomeInput, TileKey } from './home'

/** The warehouse rows of `role_permissions` as they actually stand in the live
 *  database, read on 2026-08-20. Testing against invented permissions would
 *  prove nothing: the whole point is that these are the grants Aksha has
 *  configured, including the one that surprised us — `engineer` has can_edit,
 *  so engineers are not view-only and legitimately reach the gate screens. */
const LIVE_MATRIX: Record<string, { edit: boolean; admin: boolean; people: number }> = {
  admin: { edit: true, admin: true, people: 2 },
  head: { edit: true, admin: true, people: 4 },
  uploader: { edit: true, admin: false, people: 1 },
  engineer: { edit: true, admin: false, people: 2 },
  backoffice: { edit: true, admin: false, people: 1 },
  store_manager: { edit: true, admin: false, people: 0 },
  coordinator: { edit: true, admin: false, people: 0 },
  security: { edit: true, admin: false, people: 0 },
  viewer: { edit: false, admin: false, people: 27 },
  founder: { edit: false, admin: false, people: 1 },
  project_head: { edit: false, admin: false, people: 0 },
  billing: { edit: false, admin: false, people: 0 },
}

function input(role: string, over: Partial<HomeInput> = {}): HomeInput {
  const m = LIVE_MATRIX[role]
  return {
    canEdit: m.edit, canAdmin: m.admin, requestsOn: true, role,
    keepsAStore: false,
    items: 2803, spots: 9, todayIn: 0,
    toApprove: 0, toIssue: 0, mine: 0, canApprove: false,
    ...over,
  }
}

const keys = (i: HomeInput): TileKey[] => homeTiles(i).map(t => t.key)

describe('no tile leads to a screen that would refuse the person', () => {
  // This is the bug the old home screen shipped: eleven lanes rendered flat for
  // everybody, so a view-only Trustee was offered Gate IN, PO import and
  // Settings — and requirePermission refused all three on arrival.
  it('never offers an edit-only screen to a view-only role', () => {
    for (const role of Object.keys(LIVE_MATRIX).filter(r => !LIVE_MATRIX[r].edit)) {
      const shown = keys(input(role))
      for (const k of NEEDS_EDIT) {
        expect(shown, `${role} must not be offered "${k}"`).not.toContain(k)
      }
    }
  })

  it('never offers Settings to a non-admin', () => {
    for (const role of Object.keys(LIVE_MATRIX).filter(r => !LIVE_MATRIX[r].admin)) {
      for (const k of NEEDS_ADMIN) {
        expect(keys(input(role)), `${role} must not be offered "${k}"`).not.toContain(k)
      }
    }
  })

  it('still offers every edit screen to a role that can edit', () => {
    // The opposite failure: quietly hiding the gate screens from the people who
    // actually record entries. There are no store_manager accounts, so if this
    // were gated on "is a keeper" the module would go dark for everyone but one
    // person.
    for (const role of Object.keys(LIVE_MATRIX).filter(r => LIVE_MATRIX[r].edit)) {
      const shown = keys(input(role))
      for (const k of NEEDS_EDIT) {
        expect(shown, `${role} must keep "${k}"`).toContain(k)
      }
    }
  })
})

describe('what each real role actually sees', () => {
  it('gives the 28 view-only people a short screen', () => {
    const shown = keys(input('viewer'))
    expect(shown).toEqual(['stock', 'raise', 'mine', 'reports'])
    // Was 11 lanes plus a counter strip for exactly these people.
    expect(shown.length).toBeLessThanOrEqual(5)
  })

  it('gives an engineer the gate screens but no Settings', () => {
    const shown = keys(input('engineer'))
    expect(shown).toContain('gate-in')
    expect(shown).toContain('reports')
    expect(shown).not.toContain('settings')
    expect(shown).not.toContain('to-issue') // not a keeper, keeps no store
  })

  it('gives an admin everything, setup last', () => {
    const tiles = homeTiles(input('admin', { canApprove: true }))
    expect(tiles.filter(t => t.section === 'setup').map(t => t.key))
      .toEqual(['po', 'items', 'settings'])
    // Setup never comes before main, so the divider always renders correctly.
    const firstSetup = tiles.findIndex(t => t.section === 'setup')
    expect(tiles.slice(firstSetup).every(t => t.section === 'setup')).toBe(true)
  })

  it('shows the Trustee an approvals lane when the matrix names them', () => {
    // founder is view-only on warehouse, and that is exactly the person who
    // could never approve before. The lane must not depend on edit rights.
    const shown = keys(input('founder', { canApprove: true, toApprove: 3 }))
    expect(shown).toContain('approvals')
    expect(shown).not.toContain('gate-in')
  })
})

describe('the requests switch', () => {
  it('hides all four request tiles when the feature is off', () => {
    const shown = keys(input('admin', { requestsOn: false, canApprove: true, keepsAStore: true }))
    for (const k of ['raise', 'mine', 'approvals', 'to-issue']) {
      expect(shown).not.toContain(k as TileKey)
    }
  })
  it('keeps the rest of the module working when it is off', () => {
    expect(keys(input('admin', { requestsOn: false }))).toContain('gate-in')
  })
})

describe('keeper queue', () => {
  it('counts a named keeper whatever their base role', () => {
    expect(canStoreFor({ keepsAStore: true, role: 'engineer', canAdmin: false })).toBe(true)
    expect(keys(input('engineer', { keepsAStore: true }))).toContain('to-issue')
  })
  it('does not count someone who keeps nothing', () => {
    expect(canStoreFor({ keepsAStore: false, role: 'engineer', canAdmin: false })).toBe(false)
  })
})

describe('numbers are formatted, not printed raw', () => {
  it('groups the item count in the Indian style', () => {
    const stock = homeTiles(input('viewer')).find(t => t.key === 'stock')
    // The old screen rendered {k.n} and showed "2803".
    expect(stock?.stat).toBe('2,803 items')
  })
  it('groups a six-figure count too', () => {
    const stock = homeTiles(input('viewer', { items: 250000 })).find(t => t.key === 'stock')
    expect(stock?.stat).toBe('2,50,000 items')
  })
})

describe('stat lines replace the subtitle only when there is news', () => {
  it('stays quiet at zero', () => {
    const t = homeTiles(input('admin', { canApprove: true, toApprove: 0 }))
      .find(x => x.key === 'approvals')
    expect(t?.stat).toBeUndefined()
    expect(t?.accent).toBe('none')
  })
  it('speaks up and colours when something waits', () => {
    const t = homeTiles(input('admin', { canApprove: true, toApprove: 3 }))
      .find(x => x.key === 'approvals')
    expect(t?.stat).toBe('3 to approve')
    expect(t?.accent).toBe('warning')
    expect(t?.badge).toBe(3)
  })
})

describe('the callout names one thing', () => {
  it('prefers approvals, because nothing issues before it is approved', () => {
    expect(homeCallout({ requestsOn: true, toApprove: 2, toIssue: 5 }))
      .toEqual({ count: 2, label: 'Approvals', href: '/warehouse/requests' })
  })
  it('falls through to issuing', () => {
    expect(homeCallout({ requestsOn: true, toApprove: 0, toIssue: 5 })?.label).toBe('To issue')
  })
  it('says nothing when nothing waits, rather than an empty banner', () => {
    expect(homeCallout({ requestsOn: true, toApprove: 0, toIssue: 0 })).toBeNull()
  })
  it('says nothing when requests are switched off', () => {
    expect(homeCallout({ requestsOn: false, toApprove: 9, toIssue: 9 })).toBeNull()
  })
})

describe('the screen cannot silently go back to being a wall of prose', () => {
  it('holds every subtitle to the word budget', () => {
    // V2 shipped blurbs of up to twenty words on every tile. This is the guard.
    for (const role of Object.keys(LIVE_MATRIX)) {
      for (const t of homeTiles(input(role, { canApprove: true, keepsAStore: true }))) {
        const words = t.subtitle.trim().split(/\s+/).length
        expect(words, `"${t.title}": "${t.subtitle}"`).toBeLessThanOrEqual(MAX_SUBTITLE_WORDS)
      }
    }
  })

  it('gives every tile a subtitle, so no tile renders a blank line', () => {
    for (const t of homeTiles(input('admin', { canApprove: true }))) {
      expect(t.subtitle.trim().length, t.title).toBeGreaterThan(0)
    }
  })

  it('keeps tile keys unique, so React keys cannot collide', () => {
    const k = keys(input('admin', { canApprove: true, keepsAStore: true }))
    expect(new Set(k).size).toBe(k.length)
  })
})
