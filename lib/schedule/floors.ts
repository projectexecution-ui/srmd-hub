// Floor list for the progress matrix. Projects rarely seed `project_floors`,
// so the list is stored per-project in app_settings (key `sched_floors_<id>`)
// and falls back to this standard SRMD-tower set (top → bottom, from the NGH
// Zoho structure). Editable inline on the schedule screen.

export const DEFAULT_FLOORS: string[] = [
  'Terrace',
  '3rd Floor',
  '2nd Floor',
  '1st Floor',
  'Gr Floor',
  'G-1 Floor',
  'G-2 Floor',
  'External',
]

export function floorsSettingKey(projectId: string): string {
  return `sched_floors_${projectId}`
}

/** Parse a stored JSON array into a clean, de-duplicated floor list. */
export function parseFloors(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    const clean = arr.map(x => String(x).trim()).filter(Boolean)
    return clean.length ? Array.from(new Set(clean)) : null
  } catch {
    return null
  }
}
