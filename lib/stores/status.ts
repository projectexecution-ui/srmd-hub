// One set of words for one set of states.
//
// Aksha, 16 Sep 2026, on the preview: "Role-aware tabs, one status language".
// The section had grown two vocabularies for the same facts — the gate filter
// said "Waiting on storekeeper" while the chip beside it said nothing at all,
// and the requests filter said "With Mayank / Kanti" while the chip on the
// card said "Pending". Two words for one state is two states, as far as
// anybody reading the screen is concerned.
//
// So every state is named ONCE, here, and every screen asks this file. A new
// status cannot be invented in a component, because components no longer hold
// any status words.
//
// The label says WHOSE DESK IT IS ON wherever that is the real question —
// "With Mayank / Kanti" rather than "Pending" — because that is what somebody
// opening the screen actually wants to know. `meaning` is the one-line
// explanation, shown in the vocabulary panel and nowhere else.
//
// Pure: no React, no colours. A tone is a name, and the screens decide what
// tone looks like — the field register and the desk register paint them
// differently and must keep being able to.

export type EntryStage = 'gate' | 'complete' | 'closed' | 'void'
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'issued' | 'closed'

/** What a state MEANS to the reader, not what colour it is.
 *  wait = somebody has to act · go = moving · done = finished
 *  dead = struck out · bad = refused */
export type Tone = 'wait' | 'go' | 'done' | 'dead' | 'bad'

export interface Said {
  label: string
  tone: Tone
  /** One line, for the vocabulary panel. Never shown on a chip. */
  meaning: string
}

/** The longest a state may be called. A chip has to read across a desk, and
 *  anything longer wraps on a phone. Held by a test. */
export const MAX_LABEL = 26

const ENTRY: Record<EntryStage, Said> = {
  gate: {
    label: 'Waiting on storekeeper',
    tone: 'wait',
    meaning: 'a vehicle recorded at the gate, not yet counted in',
  },
  complete: {
    label: 'Complete',
    tone: 'done',
    meaning: 'counted in and taken into stock',
  },
  closed: {
    label: 'Closed',
    tone: 'done',
    meaning: 'received and signed for at the far end',
  },
  void: {
    label: 'Voided',
    tone: 'dead',
    meaning: 'struck out, with a reason — its stock was taken back off',
  },
}

const REQUEST: Record<RequestStatus, Said> = {
  pending: {
    label: 'With Mayank / Kanti',
    tone: 'wait',
    meaning: 'raised by a site, waiting to be approved',
  },
  approved: {
    label: 'With the storekeeper',
    tone: 'go',
    meaning: 'approved — waiting to be issued out of a store',
  },
  rejected: {
    label: 'Rejected',
    tone: 'bad',
    meaning: 'refused, with the reason on the card',
  },
  issued: {
    label: 'Issued',
    tone: 'done',
    meaning: 'the material has left the store',
  },
  closed: {
    label: 'Closed',
    tone: 'done',
    meaning: 'received and signed for at the far end',
  },
}

/** What to call an entry's stage. An unknown stage reads as the gate rather
 *  than as a blank — a row with no status looks like a bug, and the gate is
 *  the one state a new row can honestly be in. */
export function sayStage(stage: string | null | undefined): Said {
  return ENTRY[(stage ?? '') as EntryStage] ?? ENTRY.gate
}

/** What to call a request's status. */
export function sayStatus(status: string | null | undefined): Said {
  return REQUEST[(status ?? '') as RequestStatus] ?? REQUEST.pending
}

export const ENTRY_STAGES = Object.keys(ENTRY) as EntryStage[]
export const REQUEST_STATUSES = Object.keys(REQUEST) as RequestStatus[]

/**
 * Every word the section uses for a state, once each — for the panel in
 * Masters that shows people what the words mean, and for the test that keeps
 * two states from ever being called the same thing.
 *
 * `closed` is deliberately the same word on both sides: an entry that has been
 * signed for and a request that has been signed for are the same fact.
 */
export const VOCABULARY: ReadonlyArray<Said & { states: string[] }> = (() => {
  const by = new Map<string, Said & { states: string[] }>()
  for (const [k, v] of Object.entries(ENTRY)) {
    by.set(v.label, { ...v, states: [...(by.get(v.label)?.states ?? []), `entry:${k}`] })
  }
  for (const [k, v] of Object.entries(REQUEST)) {
    const seen = by.get(v.label)
    by.set(v.label, { ...v, states: [...(seen?.states ?? []), `request:${k}`] })
  }
  return [...by.values()]
})()
