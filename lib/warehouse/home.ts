import { formatCount } from './format'

/** What the warehouse home screen shows, and to whom.
 *
 *  This is deliberately pure. Every bug that has bitten this module so far was
 *  role-dependent behaviour that typechecked, linted and built perfectly and
 *  then failed on a real screen — a button the action refused, a queue nobody
 *  could see. None of that is reachable by a compiler, but all of it is
 *  reachable by a test, provided the decision lives somewhere a test can call.
 *
 *  So the page fetches counts and permissions and does nothing else; the choice
 *  of what to render is made here.
 */

export type TileKey =
  | 'stock' | 'raise' | 'mine' | 'approvals' | 'to-issue'
  | 'gate-in' | 'gate-out' | 'count' | 'register' | 'reports'
  | 'po' | 'items' | 'settings'

export type HomeTile = {
  key: TileKey
  href: string
  title: string
  /** The fixed one-liner. Held to a hard word budget — see MAX_SUBTITLE_WORDS. */
  subtitle: string
  /** Live status line; replaces the subtitle when there is something to say. */
  stat?: string
  section: 'main' | 'setup'
  badge?: number
  badgeStyle?: 'amber' | 'rose' | 'blue'
  accent: 'warning' | 'danger' | 'none'
}

export type HomeInput = {
  canEdit: boolean
  canAdmin: boolean
  /** Is the requests feature switched on at all? */
  requestsOn: boolean
  role: string | null
  /** Is this person named keeper of at least one store? */
  keepsAStore: boolean
  /** Distinct items with a quantity actually on a shelf right now. NOT the
   *  size of the catalogue: the master carries every material name IN4 has
   *  ever ordered, most of which has never been received. Showing 2,803 on a
   *  tile labelled Stock read as "you hold 2,803 items" when the true figure
   *  was 472. */
  itemsInStock: number
  /** The item master. Belongs on the Item Master tile, where it means
   *  something, and nowhere else. */
  catalogueItems: number
  spots: number
  todayIn: number
  toApprove: number
  toIssue: number
  /** Handovers that went out with no signed gate pass attached. The material
   *  has left and the paperwork has not — a follow-up that surfaces nowhere
   *  else, so it rides on the same tile. */
  passPending: number
  mine: number
  /** Can this person move ANY request on, per the approval matrix. */
  canApprove: boolean
}

/** The whole reason the old screen read as a wall: fifteen-word blurbs on every
 *  tile, repeating what the destination page already says in its own subtitle.
 *  The test asserts this ceiling so the prose cannot creep back in. */
export const MAX_SUBTITLE_WORDS = 5

/** Whole numbers with Indian grouping. Re-exported from the shared formatter
 *  so the home tiles and the Stock screen cannot print the same count two
 *  different ways. */
const nf = formatCount

/** Who gets the keeper's issue queue.
 *
 *  Being named a store's keeper counts whatever the base role is — that is how
 *  the old module worked and it is how the stores are actually set up. */
export function canStoreFor(i: Pick<HomeInput, 'keepsAStore' | 'role' | 'canAdmin'>): boolean {
  return i.keepsAStore || i.role === 'store_manager' || i.canAdmin
}

/** Every tile this person should see, in order, main section first.
 *
 *  The invariant a test can hold us to: nothing here leads to a screen that
 *  would refuse this person. A tile that promises something the next page denies
 *  is worse than no tile. */
export function homeTiles(i: HomeInput): HomeTile[] {
  const canStore = canStoreFor(i)
  const all: Array<HomeTile & { show: boolean }> = [
    {
      key: 'stock', href: '/warehouse/stock', title: 'Stock',
      subtitle: 'What lies where', stat: `${nf(i.itemsInStock)} items in stock`,
      section: 'main', accent: 'none', show: true,
    },
    {
      key: 'raise', href: '/warehouse/requests/new', title: 'Raise request',
      subtitle: 'New material need',
      section: 'main', accent: 'none', show: i.requestsOn,
    },
    {
      key: 'mine', href: '/warehouse/requests?lane=mine#lane-mine', title: 'My requests',
      subtitle: 'Everything I raised',
      stat: i.mine > 0 ? `${nf(i.mine)} open` : undefined,
      section: 'main', accent: 'none', show: i.requestsOn,
    },
    {
      key: 'approvals', href: '/warehouse/requests?lane=approve#lane-approve', title: 'Approvals',
      subtitle: 'Requests to OK',
      stat: i.toApprove > 0 ? `${nf(i.toApprove)} to approve` : undefined,
      section: 'main', badge: i.toApprove, badgeStyle: 'amber',
      accent: i.toApprove > 0 ? 'warning' : 'none',
      show: i.requestsOn && i.canApprove,
    },
    {
      key: 'to-issue', href: '/warehouse/requests?lane=issue#lane-issue', title: 'To issue',
      subtitle: 'Hand it over',
      // Two counts, one line, in the order they happen: hand it over, then
      // get the pass signed. Either alone is worth showing.
      stat: [
        i.toIssue > 0 ? `${nf(i.toIssue)} to issue` : null,
        i.passPending > 0 ? `${nf(i.passPending)} gate pass` : null,
      ].filter(Boolean).join(' · ') || undefined,
      section: 'main', badge: i.toIssue + i.passPending, badgeStyle: 'blue',
      accent: (i.toIssue > 0 || i.passPending > 0) ? 'warning' : 'none',
      // Shown when a pass is outstanding even with the requests feature off:
      // a handover whose paperwork is missing does not stop mattering.
      show: canStore && (i.requestsOn || i.passPending > 0),
    },
    {
      key: 'gate-in', href: '/warehouse/in', title: 'Gate IN',
      subtitle: 'Record a truck in',
      stat: i.todayIn > 0 ? `${nf(i.todayIn)} today` : undefined,
      section: 'main', accent: 'none', show: i.canEdit,
    },
    {
      key: 'gate-out', href: '/warehouse/out', title: 'OUT to site',
      subtitle: 'Issue or transfer',
      section: 'main', accent: 'none', show: i.canEdit,
    },
    {
      key: 'count', href: '/warehouse/count', title: 'Physical count',
      subtitle: 'Count · variance',
      section: 'main', accent: 'none', show: i.canEdit,
    },
    {
      key: 'register', href: '/warehouse/entries', title: 'Gate register',
      subtitle: 'Void · book returns',
      section: 'main', accent: 'none', show: i.canEdit,
    },
    {
      // Open to anyone who can see the module. Money is a separate question,
      // answered by wh_values_hidden_roles — an engineer opening a register
      // sees quantities and no rates.
      key: 'reports', href: '/warehouse/reports', title: 'Reports',
      subtitle: 'Registers · control',
      section: 'main', accent: 'none', show: true,
    },
    {
      key: 'po', href: '/warehouse/po', title: 'Purchase Orders',
      subtitle: 'Pull a PO from IN4',
      section: 'setup', accent: 'none', show: i.canEdit,
    },
    {
      key: 'items', href: '/warehouse/items', title: 'Item Master',
      subtitle: 'Names · units · category',
      stat: `${nf(i.catalogueItems)} in the master`,
      section: 'setup', accent: 'none', show: i.canEdit,
    },
    {
      key: 'settings', href: '/warehouse/settings', title: 'Settings',
      subtitle: `${nf(i.spots)} storage locations`,
      section: 'setup', accent: 'none', show: i.canAdmin,
    },
  ]
  // Rebuilt field by field rather than spread-minus-`show`, so the returned
  // shape is exactly HomeTile and the visibility flag cannot leak to the client.
  return all.filter(t => t.show).map(t => ({
    key: t.key,
    href: t.href,
    title: t.title,
    subtitle: t.subtitle,
    stat: t.stat,
    section: t.section,
    badge: t.badge,
    badgeStyle: t.badgeStyle,
    accent: t.accent,
  }))
}

/** The SINGLE most urgent thing waiting on this person, for the top banner.
 *  Approvals outrank issuing: nothing can be issued until it is approved. */
export function homeCallout(
  i: Pick<HomeInput, 'requestsOn' | 'toApprove' | 'toIssue'>,
): { count: number; label: string; href: string } | null {
  if (!i.requestsOn) return null
  if (i.toApprove > 0) return { count: i.toApprove, label: 'Approvals', href: '/warehouse/requests?lane=approve#lane-approve' }
  if (i.toIssue > 0) return { count: i.toIssue, label: 'To issue', href: '/warehouse/requests?lane=issue#lane-issue' }
  return null
}

/** Which tiles lead to a screen that needs more than plain view access.
 *  Used by the test to prove no tile is offered to somebody it would refuse. */
export const NEEDS_EDIT: TileKey[] = ['gate-in', 'gate-out', 'count', 'register', 'po', 'items']
export const NEEDS_ADMIN: TileKey[] = ['settings']
