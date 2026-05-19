// Shared helpers for /budget — formulas and parsing logic copied 1:1
// from Budget_vs_Actual_Dashboard.html so behaviour stays identical.

export type ParsedRow = { head: string; budget: number; actual: number }
export type DetectedMap = { head: number; budget: number; actual: number; variance: number }

export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr'
  if (abs >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L'
  if (abs >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K'
  return '₹' + (n as number).toFixed(0)
}

export function formatINRFull(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return '₹' + Math.round(n as number).toLocaleString('en-IN')
}

export function toLakh(n: number): number {
  return n / 1e5
}

// Smart column detection — picks the header row by keyword score
// then identifies head/budget/actual/variance columns.
export function detectColumns(raw: (string | number | null)[][]): {
  headerRow: string[]
  bestRow: number
  map: DetectedMap
} {
  const keywords = ['budget', 'actual', 'head', 'description', 'item', 'particular', 'variance', 'cost', 'category']
  let bestRow = 0
  let bestScore = -1

  for (let i = 0; i < Math.min(raw.length, 15); i++) {
    const row = raw[i] || []
    let score = 0
    row.forEach(c => {
      if (typeof c === 'string') {
        const lc = c.toLowerCase()
        keywords.forEach(k => { if (lc.includes(k)) score += 2 })
        if (c.trim().length > 0 && c.trim().length < 40) score += 0.5
      }
    })
    if (score > bestScore) { bestScore = score; bestRow = i }
  }

  const headerRow: string[] = (raw[bestRow] || []).map(c =>
    c === null || c === undefined ? '' : String(c).trim()
  )

  const headLower = headerRow.map(h => h.toLowerCase())
  const findCol = (...kws: string[]) => {
    for (let i = 0; i < headLower.length; i++) {
      for (const kw of kws) if (headLower[i].includes(kw)) return i
    }
    return -1
  }

  const map: DetectedMap = {
    head: findCol('head', 'description', 'item', 'particular', 'category', 'sr', 'name'),
    budget: findCol('budget', 'estimated', 'planned', 'allocated', 'sanction'),
    actual: findCol('actual', 'incurred', 'spent', 'consumed', 'utilised', 'utilized', 'expense'),
    variance: findCol('variance', 'difference', 'over', 'under'),
  }

  // Fallback: if budget/actual not found, take first numeric columns
  if (map.budget === -1 || map.actual === -1) {
    const numCols: { col: number; count: number }[] = []
    for (let c = 0; c < headerRow.length; c++) {
      let numCount = 0
      for (let r = bestRow + 1; r < raw.length; r++) {
        const v = raw[r]?.[c]
        if (typeof v === 'number' && !isNaN(v)) numCount++
      }
      if (numCount > 0) numCols.push({ col: c, count: numCount })
    }
    numCols.sort((a, b) => b.count - a.count)
    if (map.budget === -1 && numCols[0]) map.budget = numCols[0].col
    if (map.actual === -1 && numCols[1]) map.actual = numCols[1].col
  }
  if (map.head === -1) {
    for (let c = 0; c < headerRow.length; c++) {
      let strCount = 0
      for (let r = bestRow + 1; r < Math.min(raw.length, bestRow + 20); r++) {
        if (typeof raw[r]?.[c] === 'string') strCount++
      }
      if (strCount > 2) { map.head = c; break }
    }
    if (map.head === -1) map.head = 0
  }

  return { headerRow, bestRow, map }
}

export function buildRows(
  raw: (string | number | null)[][],
  bestRow: number,
  map: DetectedMap,
): ParsedRow[] {
  const out: ParsedRow[] = []
  for (let r = bestRow + 1; r < raw.length; r++) {
    const row = raw[r]
    if (!row) continue
    const head = row[map.head]
    const budget = row[map.budget]
    const actual = row[map.actual]
    if (!head || (typeof budget !== 'number' && typeof actual !== 'number')) continue
    const headStr = String(head).trim()
    if (!headStr) continue
    // Skip total rows in detail (we compute our own)
    if (/^(grand\s*)?total/i.test(headStr)) continue
    out.push({
      head: headStr,
      budget: typeof budget === 'number' ? budget : 0,
      actual: typeof actual === 'number' ? actual : 0,
    })
  }
  return out
}
