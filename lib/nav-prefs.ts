// Reading the sidebar's remembered state back out of localStorage.
//
// This exists because of a real crash. The revamp trial's Projects lane stored
// `srmd_nav_projects_open` as a plain flag — the string "1" or "0" — while the
// version that landed on main stores an OBJECT under the same key: which
// branches are expanded, keyed by project id. Anyone whose browser had used
// the trial still had "1" sitting there, so `JSON.parse` handed back the NUMBER
// 1, and the very next line did `projectId in 1`:
//
//     TypeError: Cannot use 'in' operator to search for '<uuid>' in 1
//
// The sidebar renders inside app/(app)/layout.tsx, and an error.tsx never
// catches a failure in the layout beside it, so this took down EVERY page in
// the hub with Next's blank error screen.
//
// The lesson is bigger than the key collision: localStorage is UNTRUSTED INPUT.
// It survives deploys, it is shared by every version of the app that ever ran
// on that origin, and the user can edit it. A `JSON.parse` inside a try/catch
// is not enough — the catch only fires on malformed JSON, and "1" is perfectly
// valid JSON. The shape has to be checked after parsing, which is what these
// functions do.

/** A map of "is this branch expanded", keyed by id. */
export type OpenMap = Record<string, boolean>

/**
 * Parse a stored open-map, returning `null` for anything that is not one.
 *
 * Null rather than `{}` on purpose: the caller can then tell "nothing stored"
 * from "something unusable is stored" and clear the bad value, so a poisoned
 * key stops biting instead of being re-read on every page load.
 */
export function parseOpenMap(raw: string | null | undefined): OpenMap | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  // The trial's "1"/"0" landed here as a number; a stray "true" as a boolean.
  // Arrays are objects too, and `id in []` does not throw but is never right.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const out: OpenMap = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    // Keep only genuine booleans. A value of some other type would flow into
    // the UI as a truthy/falsy accident rather than a remembered choice.
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

/**
 * Read an open-map from localStorage, deleting the key when what is there
 * cannot be used. Safe in a private window or where storage is blocked — both
 * throw on access, and both mean "no preference", not "crash the sidebar".
 */
export function readOpenMap(key: string): OpenMap {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return {}
  }
  if (raw == null) return {}

  const map = parseOpenMap(raw)
  if (map) return map

  // Left over from an older version of the app. Drop it rather than parse it
  // again on every render for the rest of this browser's life.
  try { localStorage.removeItem(key) } catch { /* nothing else to do */ }
  return {}
}

/** Write an open-map back. Never throws — a browser that refuses to store the
 *  preference should not break the click that set it. */
export function writeOpenMap(key: string, map: OpenMap): void {
  try { localStorage.setItem(key, JSON.stringify(map)) } catch { /* private mode */ }
}

/**
 * Read a stored "1"/"0" flag. Anything else — including an object left by a
 * different version of the app under the same key — reads as no preference.
 */
export function readFlag(key: string): boolean | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return null
  }
  if (raw === '1') return true
  if (raw === '0') return false
  if (raw != null) { try { localStorage.removeItem(key) } catch { /* ignore */ } }
  return null
}

export function writeFlag(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* private mode */ }
}
