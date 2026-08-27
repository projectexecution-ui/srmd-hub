// Adhoc vs "as per BOQ" — the HOD's point 7.
//
// His rule, verbatim: the option comes from the Project Head when he is asked
// to select at sign-off; if he forgets, the Atm Head and the Trustee can also
// select. Anything not marked adhoc, with its working linked, counts as per
// BOQ.
//
// So this is a DECLARATION, not a derivation. An earlier guess — "as per BOQ =
// the sub-category has an [IB…] baseline" — would have been wrong: a sheet can
// sit under a baselined sub-category and still be extra work.
//
// Three states, and the third one matters. `null` is "nobody has been asked
// yet", which is exactly the case the HOD anticipated ("if Mayank bhai
// forgets"). Defaulting it to false would print "BOQ" against 69 existing
// sheets on nobody's authority.

export type AdhocState = 'adhoc' | 'boq' | 'undeclared'

export function adhocStateOf(isAdhoc: boolean | null | undefined): AdhocState {
  if (isAdhoc === true) return 'adhoc'
  if (isAdhoc === false) return 'boq'
  return 'undeclared'
}

export const ADHOC_LABEL: Record<AdhocState, string> = {
  adhoc: 'Adhoc',
  boq: 'As per BOQ',
  undeclared: 'Not declared',
}

/** Short form for a table cell / chip, where the row is already narrow. */
export const ADHOC_SHORT: Record<AdhocState, string> = {
  adhoc: 'ADHOC',
  boq: 'BOQ',
  undeclared: '—',
}

export const ADHOC_HINT: Record<AdhocState, string> = {
  adhoc: 'Extra work, outside the original BOQ estimate',
  boq: 'Covered by the original BOQ estimate',
  undeclared: 'Nobody has said yet whether this is adhoc or as per BOQ — the Project Head, Atm Head or Trustee can set it',
}
