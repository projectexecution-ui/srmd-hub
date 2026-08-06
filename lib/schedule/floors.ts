// Floor list for the progress matrix. Projects rarely seed `project_floors`,
// so the list is stored per-project in app_settings (key `sched_floors_<id>`)
// and falls back to this standard SRMD-tower set. Always displayed in natural
// ascending building order (see sortFloors) so it never reads as random.

export const DEFAULT_FLOORS: string[] = [
  'G-2 Floor',
  'G-1 Floor',
  'Gr Floor',
  '1st Floor',
  '2nd Floor',
  '3rd Floor',
  'Terrace',
  'External',
]

export function floorsSettingKey(projectId: string): string {
  return `sched_floors_${projectId}`
}

/** Rank a floor name for natural ascending order: basements (lowest first) →
 *  ground → numbered floors → terrace/roof → external/site (always last). */
export function floorRank(name: string): number {
  const s = name.trim().toLowerCase()
  if (/external|site|premises|surround|compound/.test(s)) return 100000
  if (/terrace|roof|parapet|overhead|\boht\b|\bohh?t\b/.test(s)) return 90000
  // strip the word "floor" + spaces/dots so "Gr Floor"->"gr", "G-1 Floor"->"g-1"
  const core = s.replace(/floors?/g, '').replace(/[.\s]+/g, '').trim()
  // basements: g-1 / g2 / b1 / lg1 → below ground, deeper = lower
  let m = core.match(/^(?:g|b|lg|ug|sb|bg)-?(\d+)$/)
  if (m) return -parseInt(m[1], 10)
  if (/^(gr|grd|ground|gf|g)$/.test(core)) return 0
  // numbered upper floors: "1st", "2nd", "3", "10th"
  m = core.match(/^(\d+)/)
  if (m) return parseInt(m[1], 10)
  return 50000 // unknown → mid, before terrace/external, stable
}

/** Sort floor names ascending (ground-up), stable for equal ranks. */
export function sortFloors(names: string[]): string[] {
  return names
    .map((name, idx) => ({ name, idx, rank: floorRank(name) }))
    .sort((a, b) => (a.rank - b.rank) || (a.idx - b.idx))
    .map(x => x.name)
}

/** Parse a stored JSON array into a clean, de-duplicated, ascending floor list. */
export function parseFloors(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    const clean = arr.map(x => String(x).trim()).filter(Boolean)
    return clean.length ? sortFloors(Array.from(new Set(clean))) : null
  } catch {
    return null
  }
}
