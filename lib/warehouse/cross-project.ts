/** Borrowing from another project's store.
 *
 *  Aksha's rule: if an engineer asks a DIFFERENT project's store for material,
 *  it is always on a returnable footing — that stock was bought against another
 *  project's budget, so it either comes back or somebody with authority says it
 *  need not. The engineer does not get to decide that; the Atm Head does, and he
 *  can decide it AFTER approving, which is the point. Locking the choice at raise
 *  time is what made this rigid before.
 *
 *  A store with no project is shared — Central Store, the CT containers — and
 *  asking from it is never cross-project.
 */

export type StoreOwner = {
  /** The project whose stock this store holds; null when it is shared. */
  projectId: string | null
}

export type RequestScope = {
  /** The project the material is being asked FOR; null when not stated. */
  projectId: string | null
}

/** Is this request reaching into another project's stock?
 *
 *  Deliberately conservative on the missing-project case: a store that BELONGS
 *  to a project, asked by a request that names no project at all, counts as
 *  cross-project. We cannot show it is the same project, and the alternative
 *  makes the rule trivially avoidable by leaving the project blank. Naming the
 *  owning project on the request is what turns the lock off. */
export function isCrossProject(store: StoreOwner, req: RequestScope): boolean {
  if (!store.projectId) return false              // shared store — always fine
  if (!req.projectId) return true                 // cannot prove it is the same
  return store.projectId !== req.projectId
}

/** Why the Returnable tick is forced on, in words the engineer can act on.
 *
 *  Never just disable the control: a tick that cannot be changed and does not
 *  say why reads as a bug. Returns null when the engineer is free to choose. */
export function returnableLock(
  store: StoreOwner,
  req: RequestScope,
  storeProjectName: string | null,
): string | null {
  if (!isCrossProject(store, req)) return null
  const whose = storeProjectName ? `${storeProjectName}'s` : 'another project’s'
  return req.projectId
    ? `This is ${whose} stock, so it has to be on a returnable basis. `
      + 'Your Atm Head can waive the return after approving it.'
    : `This is ${whose} stock. Name the project you are asking for — if it is the `
      + 'same project the store belongs to, the return is not forced.'
}

// ---------------------------------------------------------------------------
// Releasing the return, after approval
// ---------------------------------------------------------------------------

export type WaivableLine = {
  lineId: string
  isReturnable: boolean
  /** Already released? */
  waivedAt: string | null
  /** Handed over so far — nothing to release if nothing went out. */
  issuedQty: number
}

/** Statuses at which a return can be released.
 *
 *  Only once the request is approved: waiving a return on something nobody has
 *  agreed to yet is deciding the answer before the question. */
export const WAIVE_FROM: readonly string[] = ['approved', 'part_issued', 'issued', 'closed']

/** Why this person cannot release this return, or null to go ahead.
 *
 *  `canWaive` is the permission answer (Atm Head or admin) computed by the
 *  caller from the same role rules everything else uses — this function decides
 *  the DOMAIN question only, so it stays testable. */
export function waiveBlocker(args: {
  status: string
  canWaive: boolean
  lines: WaivableLine[]
}): string | null {
  if (!args.canWaive) {
    return 'Only the Atm Head or an admin can decide that material need not come back.'
  }
  if (!WAIVE_FROM.includes(args.status)) {
    return 'This request has not been approved yet, so there is no return to release.'
  }
  const returnable = args.lines.filter(l => l.isReturnable)
  if (returnable.length === 0) {
    return 'Nothing on this request was returnable.'
  }
  if (returnable.every(l => l.waivedAt)) {
    return 'Every returnable line on this request has already been released.'
  }
  return null
}

/** The lines a "not required to take back" would actually affect. */
export function waivableLines(lines: WaivableLine[]): WaivableLine[] {
  return lines.filter(l => l.isReturnable && !l.waivedAt)
}

/** Is this single line still expected back? What the Returnables report counts.
 *
 *  A waived line is closed even though nothing physically returned — that is the
 *  whole point of the waiver, and why it is stamped with who decided it. */
export function stillExpectedBack(line: WaivableLine): boolean {
  return line.isReturnable && !line.waivedAt && line.issuedQty > 0
}

/** One line of plain English for the request screen. */
export function returnSummary(lines: WaivableLine[]): string | null {
  const returnable = lines.filter(l => l.isReturnable)
  if (returnable.length === 0) return null
  const waived = returnable.filter(l => l.waivedAt).length
  const open = returnable.length - waived
  if (waived === 0) {
    return `${open} ${open === 1 ? 'item' : 'items'} must come back`
  }
  if (open === 0) {
    return `${waived} ${waived === 1 ? 'item' : 'items'} released — no need to return`
  }
  return `${open} still to come back · ${waived} released`
}
