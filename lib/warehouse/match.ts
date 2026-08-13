/** Suggesting which item master entry an IN4 material name refers to.
 *
 *  IN4 writes generic names, the item master writes specific ones —
 *  "TEPLON TAPE" vs "TEPLON TAPE (YELLOW)", "ANGLE COCK" vs "ANGLE COCK SELF
 *  CLOSING SYSTEM (F31003ACP)". Only 1.3% match exactly, so this produces a
 *  ranked SUGGESTION for a human to confirm; it is never trusted on its own.
 *  Once confirmed, the pairing is stored as an alias and this code is bypassed. */

export function aliasKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const STOP = new Set(['and', 'the', 'of', 'for', 'with', 'type', 'etc', 'x'])

function tokens(s: string): string[] {
  return aliasKey(s).split(' ').filter(t => t.length > 1 && !STOP.has(t))
}

/** A size token like 25mm / 110mm / 10kg / 16w — the part that must NOT be
 *  wrong. Matching "25MM COUPLER" to a 50mm fitting is worse than no match. */
const SIZE = /^(\d+(?:\.\d+)?)(mm|cm|m|kg|gm|w|ltr|inch|sqm|mt)$/

function sizes(toks: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < toks.length; i++) {
    const m = toks[i].match(SIZE)
    if (m) { out.push(m[1] + m[2]); continue }
    // IN4 also writes "25 mm" as two tokens
    if (/^\d+(?:\.\d+)?$/.test(toks[i]) && i + 1 < toks.length && /^(mm|cm|m|kg|gm|w|ltr|inch|sqm|mt)$/.test(toks[i + 1])) {
      out.push(toks[i] + toks[i + 1])
    }
  }
  return out
}

export type Suggestion = { itemId: string; name: string; unit: string; score: number }

/** Score 0–1. Above ~0.5 the guess is usually right; below that it is offered
 *  but the dropdown stays open so nobody accepts a wrong item by reflex. */
export function suggestItems(
  materialText: string,
  items: Array<{ id: string; name: string; unit: string }>,
  limit = 6,
): Suggestion[] {
  const mToks = tokens(materialText)
  if (mToks.length === 0) return []
  const mSet = new Set(mToks)
  const mSizes = sizes(mToks)

  const scored: Suggestion[] = []
  for (const it of items) {
    const iToks = tokens(it.name)
    if (iToks.length === 0) continue
    const iSet = new Set(iToks)

    let shared = 0
    for (const t of mSet) if (iSet.has(t)) shared++
    if (shared === 0) continue

    // How much of the IN4 name is accounted for, and how much of the item name
    // is noise (brand codes, colours) — a little noise is fine, a lot is not.
    const coverage = shared / mSet.size
    const precision = shared / iSet.size
    let score = coverage * 0.75 + precision * 0.25

    const iSizes = sizes(iToks)
    if (mSizes.length > 0) {
      const sizeHit = mSizes.some(s => iSizes.includes(s))
      // A conflicting size is disqualifying: 25mm is not 50mm.
      if (!sizeHit && iSizes.length > 0) continue
      if (sizeHit) score = Math.min(1, score + 0.2)
      else score *= 0.6           // item carries no size at all — weaker, not wrong
    }

    scored.push({ itemId: it.id, name: it.name, unit: it.unit, score: Number(score.toFixed(3)) })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, limit)
}
