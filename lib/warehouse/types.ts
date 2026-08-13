/** Warehouse V2 — Site Material In-Out register.
 *  A separate module from `inventory`: its own items, locations, stock and
 *  ledger, so the never-adopted request/issue chain stays untouched. */

export type WhSite = {
  id: string
  code: string
  name: string
  spots: WhSpot[]
}

export type WhSpot = {
  id: string
  code: string
  name: string
  siteName: string
  /** Who may POST entries here. Everyone with view can still SEE the stock —
   *  that is the point of a shared warehouse. */
  keeperId: string | null
}

export type WhItem = {
  id: string
  code: string | null
  name: string
  /** Locked to the item. One wrong unit poisons an item's stock forever. */
  unit: string
  category: string | null
  lastRate: number | null
}

/** One line of a PO with its running balance. `pending` is what is still to
 *  come — NOT a shortage. A part delivery is the normal case. */
export type WhPoLine = {
  lineId: string
  itemId: string
  itemName: string
  unit: string
  ordered: number
  received: number
  pending: number
  rate: number | null
  done: boolean
}

export type WhPo = {
  id: string
  poNo: string
  kind: 'po' | 'wo'
  vendor: string | null
  entity: string | null
  status: 'open' | 'partly_received' | 'fully_received' | 'short_closed'
  /** How many gate entries have already landed against this PO. */
  deliveries: number
  lines: WhPoLine[]
}

export type StockRow = {
  itemId: string; itemName: string; unit: string
  locationId: string; locationName: string; siteName: string
  qty: number; damagedQty: number; minQty: number | null
}

export type WhLists = {
  entity: string[]
  unit: string[]
  deliveryMode: string[]
  category: string[]
  countReason: string[]
}

/** What the entry form needs to render. */
export type GateInOptions = {
  sites: WhSite[]
  /** Spots this user may post entries in — respects keeper→store scoping. */
  postableSpotIds: string[]
  /** True when scoping is off (any keeper may post anywhere) or the user is an
   *  admin/head, so the UI can explain why everything is open. */
  scopingOff: boolean
  items: WhItem[]
  pos: WhPo[]
  lists: WhLists
  projects: Array<{ id: string; name: string }>
  nextEntryNo: string
}

export type GateInLineInput = {
  itemId: string
  poLineId?: string | null
  challanQty: number
  receivedQty: number
  damagedQty: number
  rate: number | null
  rateSource: 'po' | 'typed' | 'last' | null
}

export type GateInInput = {
  owner: 'srm' | 'vendor'
  poId: string | null
  poNoText: string | null
  noPoReason: string | null
  party: string
  entity: string | null
  projectId: string | null
  locationId: string
  deliveryMode: string | null
  vehicleNo: string | null
  driverMobile: string | null
  challanNo: string | null
  challanDate: string | null
  remarks: string | null
  lines: GateInLineInput[]
}

/** The two checks a gate entry runs. They are deliberately separate: mixing
 *  them would flag every part delivery as short, and a report that cries wolf
 *  on everything stops being opened. */
export type LineVerdict = {
  /** challan vs this truck — a real loss. */
  shortQty: number
  damagedQty: number
  goodQty: number
  /** PO vs everything received so far — a balance, not a shortage. */
  poPendingAfter: number | null
  poOverBy: number | null
  poCompletes: boolean
}

export function verdictFor(
  line: { challanQty: number; receivedQty: number; damagedQty: number },
  po: { ordered: number; received: number } | null,
): LineVerdict {
  const shortQty = line.challanQty - line.receivedQty
  const goodQty = line.receivedQty - line.damagedQty
  if (!po) {
    return { shortQty, damagedQty: line.damagedQty, goodQty, poPendingAfter: null, poOverBy: null, poCompletes: false }
  }
  const after = po.ordered - (po.received + line.receivedQty)
  return {
    shortQty,
    damagedQty: line.damagedQty,
    goodQty,
    poPendingAfter: after > 0 ? after : 0,
    poOverBy: after < 0 ? -after : null,
    poCompletes: after === 0,
  }
}
