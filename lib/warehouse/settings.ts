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

export type SectionKey =
  | 'arrives' | 'goes-out' | 'counting' | 'pos' | 'closing'
  | 'who-can' | 'who-where' | 'lists' | 'sync' | 'from-hub'

export type SettingDef = {
  key: SettingKey
  section: SectionKey
  kind: 'toggle' | 'date' | 'roles'
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
    section: 'arrives',
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
    section: 'counting',
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
    section: 'counting',
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
    section: 'counting',
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
    section: 'closing',
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
    section: 'closing',
    kind: 'date',
    label: 'Locked up to and including',
    onEffect: 'Entries dated on or before this date are refused while the lock is on.',
    offEffect: 'With no date set the lock does nothing, however it is switched.',
    fallback: '',
    enforcedAt: 'Saving any Gate IN, OUT or count',
  },
  {
    key: 'wh_values_hidden_roles',
    section: 'who-can',
    kind: 'roles',
    label: 'Hide rates and values from these roles',
    onEffect: 'The permissions matrix decides which SCREENS a role opens; it cannot do columns. This does the '
      + 'columns. The chosen roles see quantities only — no rate, no ₹, no value column anywhere in the module.',
    offEffect: 'Everyone who can open a screen sees what the material cost. A guard needs to record a truck; '
      + 'he does not need to know its value.',
    recommended: true,
    fallback: 'security,site_staff,contractor',
    enforcedAt: 'Every screen and every export in the module',
  },
  {
    key: 'wh_auto_sync_on_upload',
    section: 'sync',
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
    key: 'wh_any_keeper_any_store',
    section: 'who-where',
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
  { key: 'arrives',   icon: '🚚', title: 'When material arrives',            subtitle: 'What the guard is warned about at the gate' },
  { key: 'goes-out',  icon: '🏗️', title: 'When material goes out to a site', subtitle: 'What the store checks before handing over' },
  { key: 'counting',  icon: '📋', title: 'Counting the stock',               subtitle: 'The rules that decide whether a count means anything' },
  { key: 'pos',       icon: '📄', title: 'Purchase orders',                  subtitle: 'Part deliveries and abandoned orders' },
  { key: 'closing',   icon: '🔒', title: 'Closing the accounts',             subtitle: 'Keeping a closed month closed' },
  { key: 'who-can',   icon: '👥', title: 'Who can do what',                  subtitle: 'Shown here · actually set in Admin ▸ Permissions' },
  { key: 'who-where', icon: '🔐', title: 'Stores and who keeps them',        subtitle: 'Add a store, rename one, retire one — and say who may post in it' },
  { key: 'lists',     icon: '📝', title: 'Your lists',                       subtitle: 'The words the system uses — you maintain these, never a developer' },
  { key: 'sync',      icon: '🔄', title: 'Bring across from IN4',            subtitle: 'Items, units, trades and purchase orders out of the weekly upload' },
  { key: 'from-hub',  icon: '🏛️', title: 'Comes from the hub',               subtitle: 'Already built and shared — nothing to set up here' },
]

/** Rules from the design review that are NOT built, and why — shown in their own
 *  section rather than as switches that store a value and change nothing. */
export const NOT_BUILT: Array<{ section: SectionKey; label: string; why: string }> = [
  {
    section: 'goes-out',
    label: 'Make the store wait for approval before giving material',
    why: 'There is no approval step on an OUT entry to switch on — the engineer signs and takes it. '
      + 'Adding one is a change to the OUT flow, not a setting.',
  },
  {
    section: 'goes-out',
    label: 'Warn if a site draws more than it estimated',
    why: 'Needs each warehouse item tied to a Cost Control estimate line. Nothing links them yet — the same '
      + 'gap that keeps the "Issued vs estimate" report unbuilt.',
  },
  {
    section: 'goes-out',
    label: 'Warn at the gate if one trust’s material goes to another trust’s project',
    why: 'The report exists — Entity vs project, under Control reports. Warning at the moment of issue needs '
      + 'each project to carry its own entity, and the projects list does not have one.',
  },
  {
    section: 'goes-out',
    label: 'Chase material that is supposed to come back',
    why: 'The Returnables outstanding report is live and shows exactly this. Sending it out on a schedule is a '
      + 'new job on the cron dispatcher, which is its own build rather than a switch.',
  },
  {
    section: 'counting',
    label: 'Remind us to count',
    why: 'Same reason: a monthly spot-check and quarterly full-count reminder is a scheduled job, not a rule '
      + 'this module applies while somebody is using it.',
  },
  {
    section: 'pos',
    label: 'Only the Atm Head can close a part-delivered order',
    why: 'Nothing can short-close a PO yet — the status exists in the database but no screen sets it. '
      + 'The authority question only arises once the action does.',
  },
  {
    section: 'pos',
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
export const VALUE_HIDEABLE_ROLES: Array<{ id: string; label: string }> = [
  { id: 'security', label: 'Security guard' },
  { id: 'site_staff', label: 'Site staff' },
  { id: 'contractor', label: 'Contractor' },
  { id: 'engineer', label: 'Site engineer' },
  { id: 'store_manager', label: 'Storekeeper' },
]
