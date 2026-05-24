/**
 * Layer 1 duplicate detection (lexical Jaccard) for the WS editor.
 * Runs entirely client-side — instant feedback as the engineer types.
 *
 * Spec §5.3:
 *   - Lowercase, strip punctuation, sort tokens, compute Jaccard similarity
 *   - Flag if > 0.85 (high) or > 0.75 (medium)
 *   - Catches typos and word reordering
 *
 * Layers 2 (OpenAI semantic) and 3 (triplet match) defer to later sessions.
 */

export interface PastItem {
  id: string
  description: string
  ws_id: string
  ws_code: string
  qty: number
  uom: string
  rate: number
  vendor_id: string | null
}

export interface DupMatch {
  item: PastItem
  score: number
  level: 'high' | 'medium'
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'to', 'with', 'within', 'into', 'onto',
  'per', 'as', 'work', 'works', 'works.', 'item', 'items',
])

function tokenize(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')        // strip punctuation
      .replace(/\d+(\.\d+)?/g, '')     // strip standalone numbers (so "5mm" stays as "mm")
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length >= 2 && !STOPWORDS.has(t)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const t of a) if (b.has(t)) intersect++
  const union = a.size + b.size - intersect
  return intersect / union
}

/**
 * Score a candidate description against the corpus of past items.
 * Returns the top N matches above the threshold.
 */
export function findDuplicateMatches(
  description: string,
  pastItems: PastItem[],
  opts: { highThreshold?: number; mediumThreshold?: number; topN?: number } = {},
): DupMatch[] {
  const highThreshold = opts.highThreshold ?? 0.85
  const mediumThreshold = opts.mediumThreshold ?? 0.75
  const topN = opts.topN ?? 3

  const candidate = tokenize(description)
  if (candidate.size < 2) return []

  const matches: DupMatch[] = []
  for (const item of pastItems) {
    const past = tokenize(item.description)
    const score = jaccard(candidate, past)
    if (score >= mediumThreshold) {
      matches.push({
        item,
        score,
        level: score >= highThreshold ? 'high' : 'medium',
      })
    }
  }
  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, topN)
}
