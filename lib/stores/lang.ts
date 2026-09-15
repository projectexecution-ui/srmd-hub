// The words on the gate and storekeeper screens.
//
// English only. It was briefly bilingual — Aksha asked for Gujarati on
// 13 Sep 2026 and then, having seen it, asked for it out the same day. The
// switch, the setting and the second language are all gone rather than left
// behind a flag: a language nobody wants is not a feature waiting to be
// turned on, it is a second copy of every label to keep in step.
//
// What that experiment leaves behind, and what still matters, is the
// DISCIPLINE it forced. Every phrase lives in this one list, so the whole
// vocabulary of the two screens can be read end to end in one place, and the
// tests hold it to plain words: nothing longer than a phone line, nothing
// that names a database column. "Who has brought it?" not "Party".
//
// That rule exists for the same reason the Gujarati did — Aksha, 13 Sep 2026:
// "Security - Storekeeper who are less educated - so also make it
// accordingly". Simple English is what is left of it, and it is doing most of
// the work anyway; the wizard, the pictures and the big targets do the rest.

export const T = {
  /* ── The gate wizard ──────────────────────────────────────────────────── */
  gateTitle:      'Vehicle at the gate',
  next:           'Next',
  back:           'Back',
  save:           'Save',
  cancel:         'Cancel',
  skip:           'Not known — skip',

  // 1 · which register
  qWhat:          'What has come?',
  vendorTitle:    'Vendor material',
  vendorSub:      'Goes straight to the site',
  srmTitle:       'Our own stock',
  srmSub:         'Goes into the store',

  // 2 · who
  qWho:           'Who has brought it?',
  whoHint:        'Pick the shop, or type the name',
  notInList:      'Not in the list — type it',
  backToList:     'Pick from the list instead',
  typedByHand:    'Typed by hand',

  // 3 · how
  qHow:           'How has it come?',

  // 4 · vehicle
  qVehicle:       'Vehicle number',
  vehicleHint:    'As written on the vehicle',

  // 5 · driver
  qDriver:        'Driver',
  driverName:     'Name',
  driverMobile:   'Mobile number',
  driverLicence:  'Licence number',

  // 6 · papers
  qPapers:        'Photo of the papers',
  papersHint:     'Challan, bill, e-way bill',
  photoSoon:      'Camera coming soon',

  // 7 · confirm
  qCheck:         'Check once, then save',
  saved:          'Saved',
  savedSub:       'The storekeeper can see it now',
  newEntry:       'Another vehicle',

  /* ── The storekeeper's screen ─────────────────────────────────────────── */
  skTitle:        'What was in the vehicle?',
  whichTrust:     'Which trust is paying',
  whichProject:   'Which project',
  itemCategory:   'Item category',
  poNumber:       'Which purchase order?',
  findOrder:      'Tap to find the order',
  orderSearch:    'Type any part of the number',
  openOrders:     'Open orders',
  otherOrders:    'Already received',
  noOrder:        'Not against any order',
  orderNone:      'No order found',
  filledFromIn4:  'Filled in for you',
  changeAnyDiffer: 'Change anything that differs',
  whereKept:      'Where has it been kept?',
  item:           'Item',
  qty:            'Quantity',
  rate:           'Rate',
  amount:         'Amount',
  addItem:        'Add an item',
  remove:         'Remove',
  mustComeBack:   'Must come back',
  takeIntoStock:  'Take into stock',

  /* ── Status, said plainly ─────────────────────────────────────────────── */
  waiting:        'Waiting on storekeeper',
  done:           'Done',
  needed:         'Still needed',
} as const

/** Every phrase, for the tests that keep this list plain and short. */
export const ALL_PHRASES: ReadonlyArray<[string, string]> = Object.entries(T)

/* ── Delivery modes ─────────────────────────────────────────────────────── */

/**
 * Which icon a delivery mode gets. Matched on the WORD rather than the id, so
 * a renamed row keeps its picture — and the picture is what a guard reads
 * first, whatever the label says.
 */
export function modeIcon(name: string): 'trailer' | 'truck' | 'tempo' | 'pickup' | 'hand' | 'other' {
  const n = name.toLowerCase()
  if (n.includes('trailer')) return 'trailer'
  if (n.includes('truck')) return 'truck'
  if (n.includes('tempo')) return 'tempo'
  if (n.includes('pick')) return 'pickup'
  if (n.includes('hand')) return 'hand'
  return 'other'
}

/* ── The wizard's shape ─────────────────────────────────────────────────── */

export const GATE_STEPS = [
  'what', 'who', 'how', 'vehicle', 'driver', 'papers', 'check',
] as const
export type GateStep = (typeof GATE_STEPS)[number]

export interface GateAnswers {
  register?: 'vendor' | 'srm'
  partyName?: string
  /** IN4's supplier id when the name was picked from the list rather than
   *  typed. What makes the storekeeper's order picker exact instead of a
   *  name-match. */
  in4PartyId?: number | null
  modeName?: string
  vehicleNo?: string
  driverName?: string
  driverMobile?: string
  driverLicence?: string
}

/** Hand-delivered material has no vehicle and no driver, so those two screens
 *  are skipped entirely rather than shown with nothing to type. Asking a guard
 *  for a vehicle number that does not exist is how wrong numbers get invented. */
export function stepsFor(a: GateAnswers): GateStep[] {
  const byHand = !!a.modeName && modeIcon(a.modeName) === 'hand'
  return GATE_STEPS.filter(s => !(byHand && (s === 'vehicle' || s === 'driver')))
}

/** Can this step be left? Only the first three answers are compulsory — a guard
 *  who does not have the driver's licence must still be able to finish, or the
 *  lorry waits at the gate for a number nobody has. */
export function canLeave(step: GateStep, a: GateAnswers): boolean {
  if (step === 'what') return !!a.register
  if (step === 'who') return !!a.partyName?.trim()
  if (step === 'how') return !!a.modeName
  return true
}

/** What the confirm screen shows, in the order a person would read it out. */
export function summaryOf(a: GateAnswers): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  if (a.register) rows.push({ label: T.qWhat, value: a.register === 'vendor' ? T.vendorTitle : T.srmTitle })
  if (a.partyName?.trim()) rows.push({ label: T.qWho, value: a.partyName.trim() })
  if (a.modeName) rows.push({ label: T.qHow, value: a.modeName })
  if (a.vehicleNo?.trim()) rows.push({ label: T.qVehicle, value: a.vehicleNo.trim() })
  if (a.driverName?.trim()) rows.push({ label: T.driverName, value: a.driverName.trim() })
  if (a.driverMobile?.trim()) rows.push({ label: T.driverMobile, value: a.driverMobile.trim() })
  if (a.driverLicence?.trim()) rows.push({ label: T.driverLicence, value: a.driverLicence.trim() })
  return rows
}
