// Finding a contractor or supplier among IN4's own party master.
//
// Aksha, 13 Oct 2026: "The Vendor or Contractor should come from Live In4 data
// and if the Name is not shown then can add manually here which needs to be
// updated once its entered in iN4 - also the name picker should be advanced
// havin search features". So a bill entered without an order names its party
// the way IN4 spells it, and a name typed by hand is visibly not IN4's.
//
// Pure: parties in, ranked matches out, so it is tested.

export type PartyKind = 'contractor' | 'supplier'

export interface In4Party {
  kind: PartyKind
  id: number
  name: string
  code: string | null
  city: string | null
  /** IN4's trades for the party (in4_parties.skills). */
  trades: string[]
}

/** Same name, the way people compare them: case, spacing and invisible
 *  characters ignored. Not fuzzy — "Desai Construction" is not "Desai
 *  Construction Pvt Ltd.". */
export const sameName = (a: string, b: string): boolean => norm(a) === norm(b)

const norm = (s: string): string =>
  s.replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The IN4 party with exactly this name, if there is one. */
export function findParty(parties: In4Party[], name: string | null | undefined): In4Party | null {
  if (!name || !norm(name)) return null
  return parties.find(p => sameName(p.name, name)) ?? null
}

/** Parties matching what was typed, best first.
 *
 *  Every word typed must appear somewhere — name, IN4 code, city or a trade —
 *  so "desai surat" or "electrical vadodara" narrow the list. Ranked: the
 *  name exactly, then the name starting with it, then a word of the name
 *  starting with it, then the name containing it, then a match elsewhere.
 *  The kind the bill is for (contractor on a work order, supplier on a
 *  purchase order) comes first within each rank. */
export function searchParties(parties: In4Party[], query: string, prefer: PartyKind, limit = 30): In4Party[] {
  const q = norm(query)
  if (!q) return []
  const words = q.split(' ')
  const scored: Array<{ p: In4Party; score: number }> = []
  for (const p of parties) {
    const name = norm(p.name)
    const hay = [name, norm(p.code ?? ''), norm(p.city ?? ''), ...p.trades.map(norm)].join(' | ')
    if (!words.every(w => hay.includes(w))) continue
    const score =
      name === q ? 0
        : name.startsWith(q) ? 1
          : name.split(/[\s.,&()/-]+/).some(w => w.startsWith(words[0])) ? 2
            : name.includes(q) ? 3
              : 4
    scored.push({ p, score: score * 2 + (p.kind === prefer ? 0 : 1) })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map(s => s.p)
}
