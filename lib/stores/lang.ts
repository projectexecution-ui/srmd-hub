// Gujarati alongside English, for the screens a guard and a storekeeper use.
//
// Aksha, 13 Sep 2026: "think it should be used by Security - Storekeeper who
// are less educated - so also make it accordingly". SRMD is at Dharampur and
// the gate staff read Gujarati far more comfortably than English, so the field
// screens say everything twice: the English line for anyone who prefers it,
// the Gujarati line underneath in the same size.
//
// Deliberately NOT a translation framework. There are two languages, one is
// always shown, and a lookup table that a Gujarati speaker can read end to end
// in one screen is worth more here than i18n machinery nobody will maintain.
//
// The DESK screens — Overview, Stock, Masters, the reports — stay English.
// Aksha reads them, and doubling every label there would only clutter a screen
// that is already dense.

export interface Phrase {
  /** English. Plain words, never system jargon: "Who brought it?" not "Party". */
  en: string
  /** ગુજરાતી. */
  gu: string
}

const p = (en: string, gu: string): Phrase => ({ en, gu })

/* ── Which language the field screens speak ─────────────────────────────── */

/**
 * Aksha, 13 Sep 2026: "yes make it Gujarati only with language switch - give
 * that option to Admin only to switch on and off".
 *
 * So the field screens are GUJARATI by default and the English line is a
 * switch an admin turns on. Showing both was costing half the screen to a line
 * the guard never reads; spending it on bigger Gujarati instead is the whole
 * point of asking him.
 *
 * One setting for the whole site rather than one per person: there is no
 * sign-in for the gate phone worth calling a profile, and a guard should never
 * be able to change the language of a screen he shares with the next shift.
 */
export type FieldLang = 'gu' | 'both'

export const FIELD_LANG_KEY = 'mio_field_language'
export const DEFAULT_FIELD_LANG: FieldLang = 'gu'

/** Anything unrecognised falls back to the default rather than throwing — a
 *  bad settings row must not take the gate screen down. */
export function parseFieldLang(raw: unknown): FieldLang {
  return raw === 'both' || raw === 'gu' ? raw : DEFAULT_FIELD_LANG
}

export interface Shown {
  /** The line to lead with, always non-empty. */
  lead: string
  /** Its lang attribute, so the Gujarati font and screen readers are right. */
  leadLang: 'gu' | 'en'
  /** The second line, or null when there is only one. */
  second: string | null
  secondLang: 'gu' | 'en'
}

/**
 * What one phrase shows, given the setting.
 *
 * The fallback matters more than the rule: a phrase with no Gujarati — a
 * delivery mode an admin invented, say — shows its English even in Gujarati
 * mode. A blank label is worse than the wrong language.
 */
export function show(t: Phrase, lang: FieldLang): Shown {
  const gu = t.gu?.trim()
  const en = t.en?.trim() ?? ''
  if (!gu) return { lead: en, leadLang: 'en', second: null, secondLang: 'en' }
  if (lang === 'gu') return { lead: gu, leadLang: 'gu', second: null, secondLang: 'en' }
  return { lead: en, leadLang: 'en', second: gu, secondLang: 'gu' }
}

export const T = {
  /* ── The gate wizard ──────────────────────────────────────────────────── */
  gateTitle:      p('Vehicle at the gate',      'ગેટ પર ગાડી'),
  step:           p('Step',                      'પગલું'),
  of:             p('of',                        'માંથી'),
  next:           p('Next',                      'આગળ'),
  back:           p('Back',                      'પાછળ'),
  save:           p('Save',                      'સેવ કરો'),
  cancel:         p('Cancel',                    'રદ કરો'),
  skip:           p('Not known — skip',          'ખબર નથી — છોડી દો'),

  // 1 · which register
  qWhat:          p('What has come?',            'શું આવ્યું છે?'),
  vendorTitle:    p('Vendor material',           'વેપારીનો માલ'),
  vendorSub:      p('Goes straight to the site', 'સીધું સાઇટ પર જશે'),
  srmTitle:       p('Our own stock',             'આપણો પોતાનો સ્ટોક'),
  srmSub:         p('Goes into the store',       'સ્ટોરમાં જશે'),

  // 2 · who
  qWho:           p('Who has brought it?',       'કોણ લાવ્યું છે?'),
  whoHint:        p('Shop or company name',      'દુકાન કે કંપનીનું નામ'),
  recent:         p('Recent',                    'હમણાંના'),

  // 3 · how
  qHow:           p('How has it come?',          'કેવી રીતે આવ્યું છે?'),

  // 4 · vehicle
  qVehicle:       p('Vehicle number',            'ગાડી નંબર'),
  vehicleHint:    p('As written on the vehicle', 'ગાડી પર લખેલું છે તેમ'),

  // 5 · driver
  qDriver:        p('Driver',                    'ડ્રાઇવર'),
  driverName:     p('Name',                      'નામ'),
  driverMobile:   p('Mobile number',             'મોબાઇલ નંબર'),
  driverLicence:  p('Licence number',            'લાઇસન્સ નંબર'),

  // 6 · papers
  qPapers:        p('Photo of the papers',       'કાગળનો ફોટો'),
  papersHint:     p('Challan, bill, e-way bill', 'ચલણ, બિલ, ઈ-વે બિલ'),
  takePhoto:      p('Take photo',                'ફોટો પાડો'),
  photoSoon:      p('Camera coming soon',        'કેમેરા હમણાં નથી'),

  // 7 · confirm
  qCheck:         p('Check once, then save',     'એક વાર ચેક કરો, પછી સેવ કરો'),
  saved:          p('Saved',                     'સેવ થઈ ગયું'),
  savedSub:       p('The storekeeper can see it now', 'હવે સ્ટોરકીપર જોઈ શકશે'),
  newEntry:       p('Another vehicle',           'બીજી ગાડી'),

  /* ── Delivery modes ───────────────────────────────────────────────────── */
  Trailer:        p('Trailer',                   'ટ્રેલર'),
  Truck:          p('Truck',                     'ટ્રક'),
  Tempo:          p('Tempo',                     'ટેમ્પો'),
  Pickup:         p('Pickup',                    'પિકઅપ'),
  'Hand Delivered': p('By hand',                 'હાથમાં'),

  /* ── The storekeeper's screen ─────────────────────────────────────────── */
  skTitle:        p('What was in the vehicle?',  'ગાડીમાં શું હતું?'),
  whichTrust:     p('Which trust is paying',     'કયું ટ્રસ્ટ ચૂકવશે'),
  whichProject:   p('Which project',             'કયો પ્રોજેક્ટ'),
  poNumber:       p('PO / WO number',            'PO / WO નંબર'),
  fillFromIn4:    p('Fill the list from IN4',    'IN4 માંથી લિસ્ટ ભરો'),
  whereKept:      p('Where has it been kept?',   'ક્યાં મૂક્યું છે?'),
  item:           p('Item',                      'વસ્તુ'),
  qty:            p('Quantity',                  'જથ્થો'),
  rate:           p('Rate',                      'ભાવ'),
  amount:         p('Amount',                    'રકમ'),
  addItem:        p('Add an item',               'વસ્તુ ઉમેરો'),
  remove:         p('Remove',                    'કાઢી નાખો'),
  mustComeBack:   p('Must come back',            'પાછું આપવાનું છે'),
  takeIntoStock:  p('Take into stock',           'સ્ટોકમાં લો'),

  /* ── Status, said plainly ─────────────────────────────────────────────── */
  waiting:        p('Waiting on storekeeper',    'સ્ટોરકીપર બાકી'),
  done:           p('Done',                      'થઈ ગયું'),
  needed:         p('Still needed',              'હજી જોઈએ છે'),
} as const

export type PhraseKey = keyof typeof T

/** Every phrase, both languages, non-empty — proved by a test rather than hoped. */
export const ALL_PHRASES: ReadonlyArray<[string, Phrase]> = Object.entries(T)

/** A delivery mode's phrase, when the master row matches one we have words for.
 *  An admin who adds "Bullock cart" gets its own name and no Gujarati, which
 *  is honest — better than showing a wrong translation. */
export function modePhrase(name: string): Phrase {
  const hit = (T as Record<string, Phrase>)[name]
  return hit ?? { en: name, gu: '' }
}

/** Which icon a delivery mode gets. Matched on the word rather than the id so
 *  a renamed row keeps its picture — the picture is what a guard reads first. */
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

/** Can this step be left? Only the first two answers are compulsory — a guard
 *  who does not have the driver's licence must still be able to finish, or the
 *  lorry waits at the gate for a number nobody has. */
export function canLeave(step: GateStep, a: GateAnswers): boolean {
  if (step === 'what') return !!a.register
  if (step === 'who') return !!a.partyName?.trim()
  if (step === 'how') return !!a.modeName
  return true
}

/** What the confirm screen shows, in the order a person would read it out. */
export function summaryOf(a: GateAnswers): Array<{ label: Phrase; value: string }> {
  const rows: Array<{ label: Phrase; value: string }> = []
  if (a.register) rows.push({ label: T.qWhat, value: a.register === 'vendor' ? T.vendorTitle.en : T.srmTitle.en })
  if (a.partyName?.trim()) rows.push({ label: T.qWho, value: a.partyName.trim() })
  if (a.modeName) rows.push({ label: T.qHow, value: a.modeName })
  if (a.vehicleNo?.trim()) rows.push({ label: T.qVehicle, value: a.vehicleNo.trim() })
  if (a.driverName?.trim()) rows.push({ label: T.driverName, value: a.driverName.trim() })
  if (a.driverMobile?.trim()) rows.push({ label: T.driverMobile, value: a.driverMobile.trim() })
  if (a.driverLicence?.trim()) rows.push({ label: T.driverLicence, value: a.driverLicence.trim() })
  return rows
}
