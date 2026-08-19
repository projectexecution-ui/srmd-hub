/** The switches, and what each one actually does.
 *
 *  Every setting here is written as WHAT HAPPENS, not as a feature name — the
 *  person reading it is deciding a rule for his store, not shopping for
 *  options. Each one also says what happens when it is OFF, because a switch
 *  that only explains its "on" state hides the consequence of turning it off.
 *
 *  A switch is only listed here if it genuinely changes behaviour that exists.
 *  Rules that are not built yet live in {@link NOT_BUILT} instead, with the
 *  reason — a settings page where some toggles do nothing is worse than a
 *  shorter one, because there is no way to tell which are real.
 */

export type SettingKey =
  | 'wh_warn_over_receipt'
  | 'wh_blind_count_default'
  | 'wh_count_requires_witness'
  | 'wh_freeze_during_count'
  | 'wh_period_lock_on'
  | 'wh_period_lock_date'
  | 'wh_values_hidden_roles'
  | 'wh_any_keeper_any_store'
  | 'wh_auto_sync_on_upload'
  | 'wh_requests_on'

/** Four sections, not ten.
 *
 *  There were ten, and only nine real settings between them — three sections
 *  existed almost entirely to hold "not built yet" notes, which is a lot of
 *  screen for things that do nothing. Aksha: "there is lot of Settings which is
 *  too much of Brain to be used." So: every rule in ONE list, the two things
 *  you maintain, and one place for everything owned elsewhere. */
export type SectionKey = 'rules' | 'who-where' | 'lists' | 'elsewhere'

export type SettingDef = {
  key: SettingKey
  section: SectionKey
  kind: 'toggle' | 'date' | 'roles' | 'choice' | 'money'
  /** For `choice`: the options, in the order they should read. */
  choices?: Array<{ value: string; label: string }>
  /** For `choice` and `money`: only shown while this other setting matters,
   *  so a threshold does not sit on screen under a rule that ignores it. */
  showWhen?: { key: SettingKey; isNot?: string; is?: string }
  label: string
  /** What happens when it is on, and what happens when it is off. */
  onEffect: string
  offEffect: string
  /** Marked as protecting the user — "leave this alone unless you have a reason". */
  recommended?: boolean
  /** The default when nothing has been saved yet. */
  fallback: string
  /** Where the rule is actually applied, so a reader can check it is real. */
  enforcedAt: string
}

export const SETTINGS: SettingDef[] = [
  {
    key: 'wh_warn_over_receipt',
    section: 'rules',
    kind: 'toggle',
    label: 'Warn at the gate if more arrives than was ordered',
    onEffect: '5,100 bags against a 5,000 order shows a warning while the entry is being typed. '
      + 'The truck is never turned away — it is only recorded.',
    offEffect: 'The entry saves with no warning. It still appears on the Over-receipt report, so nothing is lost — '
      + 'the person at the gate simply is not told.',
    recommended: true,
    fallback: 'true',
    enforcedAt: 'The Gate IN screen, as the quantity is typed',
  },
  {
    key: 'wh_blind_count_default',
    section: 'rules',
    kind: 'toggle',
    label: 'Hide the book quantity while he counts',
    onEffect: 'A new count starts with the book figure hidden, so the counter cannot see "320" until he has '
      + 'entered his own number. This single switch decides whether counting is real.',
    offEffect: 'A new count starts with the book figure on screen. He will read 320 and type 320, '
      + 'and you will have a count that proves nothing. It can still be changed per count.',
    recommended: true,
    fallback: 'true',
    enforcedAt: 'The default on the Start a count screen',
  },
  {
    key: 'wh_count_requires_witness',
    section: 'rules',
    kind: 'toggle',
    label: 'Two people must sign every count',
    onEffect: 'A count cannot be submitted or approved without a witness named besides the counter. '
      + 'A keeper counting his own store alone is checking himself.',
    offEffect: 'One person can count and submit alone. The count still needs a different person to approve it, '
      + 'but nobody was standing there.',
    recommended: true,
    fallback: 'true',
    enforcedAt: 'Submitting a count, and again when it is approved',
  },
  {
    key: 'wh_freeze_during_count',
    section: 'rules',
    kind: 'toggle',
    label: 'Stop material moving while a count is on',
    onEffect: 'No IN or OUT entry can be posted in a store that has a count open. Otherwise the number keeps '
      + 'changing under his feet and every difference becomes arguable.',
    offEffect: 'Entries carry on during a count. The sheet was frozen when the count started, so anything that '
      + 'moves in between shows up as a difference that is nobody’s fault.',
    recommended: true,
    fallback: 'true',
    enforcedAt: 'Saving a Gate IN or OUT entry for that store',
  },
  {
    key: 'wh_period_lock_on',
    section: 'rules',
    kind: 'toggle',
    label: 'Lock old months once the accounts are closed',
    onEffect: 'Nobody can add or change an entry dated on or before the locked date, so "stock as on 31 March" '
      + 'stays the same figure for ever.',
    offEffect: 'A closed year’s stock value can quietly change after the auditor has seen it.',
    recommended: true,
    fallback: 'false',
    enforcedAt: 'Saving any Gate IN, OUT or count',
  },
  {
    key: 'wh_period_lock_date',
    section: 'rules',
    kind: 'date',
    label: 'Locked up to and including',
    onEffect: 'Entries dated on or before this date are refused while the lock is on.',
    offEffect: 'With no date set the lock does nothing, however it is switched.',
    fallback: '',
    enforcedAt: 'Saving any Gate IN, OUT or count',
  },
  {
    key: 'wh_values_hidden_roles',
    section: 'rules',
    kind: 'roles',
    label: 'Hide rates and values from these roles',
    onEffect: 'The permissions matrix decides which SCREENS a role opens; it cannot do columns. This does the '
      + 'columns. The chosen roles see quantities only — no rate, no ₹, no value column anywhere in the module.',
    offEffect: 'Everyone who can open a screen sees what the material cost. A guard needs to record a truck; '
      + 'he does not need to know its value.',
    recommended: true,
    fallback: 'security,viewer,engineer',
    enforcedAt: 'Every screen and every export in the module',
  },
  {
    key: 'wh_auto_sync_on_upload',
    section: 'rules',
    kind: 'toggle',
    label: 'Bring new items and purchase orders across automatically on every IN4 upload',
    onEffect: 'The moment somebody uploads an IN4 report on the Indent → PO Tracker, any material and any '
      + 'issued purchase order the warehouse does not already have is added — so the gate always knows what '
      + 'is on order without anybody remembering to press a button.',
    offEffect: 'Nothing comes across until an admin opens Bring across from IN4 and applies it by hand. '
      + 'The screen still shows exactly what is waiting.',
    recommended: true,
    fallback: 'true',
    enforcedAt: 'The IN4 upload on the Indent → PO Tracker',
  },
  {
    key: 'wh_requests_on',
    section: 'rules',
    kind: 'toggle',
    label: 'Let engineers ask a store for material',
    onEffect: 'An engineer can raise a request against any store — it lands with that store’s keeper, and he '
      + 'issues against it from the usual OUT screen. Every ask is dated, named and ageing, so "I asked last '
      + 'week" becomes a fact instead of a claim. WHO approves a request, up to what value, and in how many '
      + 'steps is yours to set in Admin ▸ Approvals, alongside every other module’s chain.',
    offEffect: 'There is no way to ask inside the app. Material still moves — the keeper records an OUT the '
      + 'moment he hands it over — but who asked, for what, and how long they waited is not captured anywhere.',
    fallback: 'false',
    enforcedAt: 'The Requests screen, and the Warehouse home tile',
  },
  {
    key: 'wh_any_keeper_any_store',
    section: 'rules',
    kind: 'toggle',
    label: 'Let any keeper post in any store',
    onEffect: 'Anyone with the Storekeeper role can post entries anywhere. Convenient when someone is on leave, '
      + 'but your count approval stops meaning much.',
    offEffect: 'A keeper posts only in the stores mapped to him below. He still SEES stock everywhere — '
      + 'that is the point of a shared warehouse — he just cannot make entries elsewhere.',
    fallback: 'false',
    enforcedAt: 'Saving any Gate IN, OUT or count, and again in the database',
  },
]

export const SECTIONS: Array<{
  key: SectionKey
  icon: string
  title: string
  subtitle: string
}> = [
  { key: 'rules',     icon: '📏', title: 'The rules',            subtitle: 'What the system warns about, refuses, or hides — nine switches' },
  { key: 'who-where', icon: '🏬', title: 'Stores and keepers',    subtitle: 'Add a store, rename one, retire one, and say who may post in it' },
  { key: 'lists',     icon: '📝', title: 'Your lists',            subtitle: 'The words the system uses — you maintain these, never a developer' },
  { key: 'elsewhere', icon: '🏛️', title: 'Set up elsewhere',      subtitle: 'Roles, people, notifications and the IN4 sync — owned by the hub, linked from here' },
]

/** Rules from the design review that are NOT built, and why.
 *
 *  One block at the very bottom, not a footnote inside four different sections.
 *  They are still listed — a switch that stores a value and changes nothing is
 *  worse than no switch, and silently dropping the list would leave no way to
 *  tell which rules are real — but they are not the first thing anybody reads. */
export const NOT_BUILT: Array<{ label: string; why: string }> = [
  {
    label: 'Make the store wait for approval before giving material',
    why: 'There is no approval step on an OUT entry to switch on — the engineer signs and takes it. '
      + 'Adding one is a change to the OUT flow, not a setting.',
  },
  {
    label: 'Warn if a site draws more than it estimated',
    why: 'Needs each warehouse item tied to a Cost Control estimate line. Nothing links them yet — the same '
      + 'gap that keeps the "Issued vs estimate" report unbuilt.',
  },
  {
    label: 'Warn at the gate if one trust’s material goes to another trust’s project',
    why: 'The report exists — Entity vs project, under Control reports. Warning at the moment of issue needs '
      + 'each project to carry its own entity, and the projects list does not have one.',
  },
  {
    label: 'Chase material that is supposed to come back',
    why: 'The Returnables outstanding report is live and shows exactly this. Sending it out on a schedule is a '
      + 'new job on the cron dispatcher, which is its own build rather than a switch.',
  },
  {
    label: 'Remind us to count',
    why: 'Same reason: a monthly spot-check and quarterly full-count reminder is a scheduled job, not a rule '
      + 'this module applies while somebody is using it.',
  },
  {
    label: 'Only the Atm Head can close a part-delivered order',
    why: 'Nothing can short-close a PO yet — the status exists in the database but no screen sets it. '
      + 'The authority question only arises once the action does.',
  },
  {
    label: 'Send a weekly list of orders with nothing delivered',
    why: 'The PO-wise pending report already flags everything with nothing arriving for 7+ days. '
      + 'Mailing it every Monday is a scheduled job.',
  },
]

// ---------------------------------------------------------------------------
// Reading and writing values. Settings are stored as text in app_settings, so
// every read goes through here rather than each screen parsing its own.
// ---------------------------------------------------------------------------

export type SettingValues = Record<string, string>

export function settingDef(key: string): SettingDef | null {
  return SETTINGS.find(s => s.key === key) ?? null
}

export function rawValue(values: SettingValues, key: SettingKey): string {
  const def = settingDef(key)
  const v = values[key]
  return v === undefined || v === null ? (def?.fallback ?? '') : v
}

export function isOn(values: SettingValues, key: SettingKey): boolean {
  return rawValue(values, key) === 'true'
}

/** Roles that see quantities but never money. */
export function valuesHiddenRoles(values: SettingValues): string[] {
  return rawValue(values, 'wh_values_hidden_roles')
    .split(',')
    .map(r => r.trim())
    .filter(Boolean)
}

/** Does this person see rates and ₹?
 *
 *  One definition for the whole module. It used to be a copy of the same
 *  function in five files, which is exactly how one screen ends up leaking a
 *  rate after somebody changes the rule. */
export function showValuesFor(
  values: SettingValues,
  role: string | null | undefined,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true
  if (!role) return true
  return !valuesHiddenRoles(values).includes(role)
}

/** The locked-up-to date, or null when the lock is off or has no date. */
export function periodLock(values: SettingValues): string | null {
  if (!isOn(values, 'wh_period_lock_on')) return null
  const d = rawValue(values, 'wh_period_lock_date').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

/** Why this entry cannot be saved, as a sentence — or null if it can.
 *
 *  On or before the locked date is refused: "locked up to 31 March" has to mean
 *  31 March itself is closed, or the last day of the year stays editable. */
export function periodLockBlocker(values: SettingValues, entryDate: string): string | null {
  const lock = periodLock(values)
  if (!lock || !entryDate) return null
  if (entryDate > lock) return null
  return `The accounts are closed up to and including ${lock}, so an entry dated ${entryDate} cannot be added or changed. `
    + 'Ask an admin if the lock date needs moving.'
}

/** The roles offered as choices for "hide rates and values". Kept to the ones
 *  that plausibly stand at a gate or on a site — offering every role in the hub
 *  would make the list unreadable. */
/** One role that can be told not to see money, as the Settings screen needs it.
 *
 *  This used to be a hardcoded list of five, and it went stale without anyone
 *  noticing: it offered `site_staff` and `security`, which nobody held, and
 *  `contractor`, which cannot open the module at all. So a switch marked
 *  Recommended was hiding money from precisely nobody while every one of the
 *  forty people with access read every rate.
 *
 *  The list is now built from the roles that ACTUALLY exist, each carrying how
 *  many people hold it and whether it can open the warehouse — so the choice
 *  shows its own consequence instead of being a guess about role names. */
export type HideableRole = {
  id: string
  label: string
  /** How many people hold this role right now. */
  people: number
  /** False when the role has no warehouse access, so hiding money from it
   *  would change nothing — worth saying rather than letting it look done. */
  hasAccess: boolean
}

/** Is a setting relevant right now? A threshold under a rule that ignores it is
 *  clutter at best and a wrong answer at worst. */
export function isRelevant(def: SettingDef, values: SettingValues): boolean {
  if (!def.showWhen) return true
  const current = rawValue(values, def.showWhen.key)
  if (def.showWhen.is !== undefined) return current === def.showWhen.is
  if (def.showWhen.isNot !== undefined) return current !== def.showWhen.isNot
  return true
}
