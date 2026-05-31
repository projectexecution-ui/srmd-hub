// localStorage persistence + snapshot diff for the procurement tracker.
// All client-only — these helpers are wrapped by client.tsx.
//
// Storage layout (all under one key, so quota errors don't fragment):
//
//   {
//     current: {                 // last full parse — restores the dashboard on reload
//       format, fileName, projects, savedAt
//     },
//     previousIndents: [         // index of last snapshot's indent statuses, used for diff
//       { indentNo, status, pendingValue }, ...
//     ],
//     previousSavedAt, previousFileName,
//     trend: [                   // ring buffer of last 3 upload metrics
//       { savedAt, pendingLineCount, pendingValue }, ...
//     ]
//   }

import type {
  ParseResult, IndentRollup, LineRecord, IndentStatusSnapshot,
  LineStatusSnapshot, StoredSnapshot, SnapshotDiff, TrendPoint,
} from './types'

const KEY = 'ct-procurement-tracker-v1'

interface Stored {
  current?: StoredSnapshot
  previousIndents?: IndentStatusSnapshot[]
  /**
   * Per-line status snapshot from the PREVIOUS upload — diff baseline
   * for the NEXT upload. Lets us flag NEW / UPDATED line rows precisely.
   */
  previousLineStatuses?: LineStatusSnapshot[]
  previousSavedAt?: string
  previousFileName?: string
  trend?: TrendPoint[]
}

function readAll(): Stored | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as Stored
  } catch { return null }
}

function writeAll(s: Stored): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Quota error (full payload too big). Retry with the heavy
    // `projects` field dropped — at least the diff baseline +
    // savedAt + trend survive so the diff banner and trend ribbon
    // keep working on the next upload.
    if (s.current?.projects) {
      try {
        const lite: Stored = { ...s, current: { ...s.current, projects: undefined } }
        localStorage.setItem(KEY, JSON.stringify(lite))
        if (typeof console !== 'undefined') {
          console.warn('[procurement-tracker] localStorage quota hit — persisted metadata only. Reload will require re-upload.')
        }
      } catch { /* even lite write failed — give up silently */ }
    }
  }
}

export function loadStoredSnapshot(): StoredSnapshot | null {
  return readAll()?.current ?? null
}

export function loadPreviousIndents(): IndentStatusSnapshot[] {
  return readAll()?.previousIndents ?? []
}

export function loadPreviousLineStatuses(): LineStatusSnapshot[] {
  return readAll()?.previousLineStatuses ?? []
}

export function loadTrend(): TrendPoint[] {
  return readAll()?.trend ?? []
}

export function loadPreviousMeta(): { savedAt: string; fileName: string } | null {
  const s = readAll()
  if (!s?.previousSavedAt) return null
  return { savedAt: s.previousSavedAt, fileName: s.previousFileName ?? '' }
}

/**
 * Persist a new upload. Moves the previous current → previousIndents so the
 * next upload can diff against it. Pushes to the trend ring buffer.
 */
export function saveSnapshot(result: ParseResult, fileName: string): void {
  const prev = readAll() ?? {}
  const allIndents = result.projects.flatMap(p => p.indents)
  const allLines = result.projects.flatMap(p => p.lines)
  const indentStatuses: IndentStatusSnapshot[] = allIndents.map(i => ({
    indentNo: i.indentNo,
    status: i.status,
    pendingValue: i.pendingValue,
  }))
  const lineStatuses: LineStatusSnapshot[] = allLines.map(l => ({
    id: l.id,
    status: l.status,
    pendingQty: l.pendingQty,
  }))
  const pendingLineCount = result.projects.reduce((s, p) => s + p.pendingLineCount, 0)
  const pendingValue = result.projects.reduce((s, p) => s + p.pendingValue, 0)
  const totalGrnValue = result.projects.reduce((s, p) => s + p.totalGrnValue, 0)
  const savedAt = new Date().toISOString()

  const next: Stored = {
    current: {
      format: result.format,
      fileName,
      savedAt,
      pendingLineCount,
      totalGrnValue,
      pendingValue,
      indentStatuses,
      lineStatuses,
      // Persist the full payload so reloads don't force a re-upload.
      // writeAll() falls back to metadata-only on quota errors.
      projects: result.projects,
    },
    // The PREVIOUS upload becomes the diff baseline for the NEXT one we make.
    previousIndents: prev.current?.indentStatuses ?? [],
    previousLineStatuses: prev.current?.lineStatuses ?? [],
    previousSavedAt: prev.current?.savedAt,
    previousFileName: prev.current?.fileName,
    trend: appendTrend(prev.trend ?? [], { savedAt, pendingLineCount, pendingValue }),
  }
  writeAll(next)
}

function appendTrend(buf: TrendPoint[], p: TrendPoint): TrendPoint[] {
  const out = [...buf, p]
  while (out.length > 3) out.shift()
  return out
}

export function clearAll(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/**
 * Diff the current parse result against the last saved snapshot. Returns
 * null when there's no baseline yet.
 *
 * Indent-level diff (changedIndents) drives the DiffBanner summary.
 * Line-level diff (newLineIds / changedLineIds) drives the per-row
 * "NEW" and "Updated" pills inside the two views.
 */
export function computeDiff(
  current: IndentRollup[],
  currentLines: LineRecord[],
  previousIndents: IndentStatusSnapshot[],
  previousLineStatuses: LineStatusSnapshot[],
  previousMeta: { savedAt: string; fileName: string } | null,
): SnapshotDiff | null {
  if (!previousMeta) return null
  // We treat "no baseline" as: at least one of the prior snapshots is empty.
  const hasIndentBaseline = previousIndents.length > 0
  const hasLineBaseline = previousLineStatuses.length > 0
  if (!hasIndentBaseline && !hasLineBaseline) return null

  // ── Indent-level diff ──────────────────────────────────────────
  const prevIndentMap = new Map(previousIndents.map(p => [p.indentNo, p]))
  const changedIndents = new Set<string>()
  let newlyGrnDone = 0
  let newlyInProgress = 0
  let newlyComplete = 0

  for (const i of current) {
    const prev = prevIndentMap.get(i.indentNo)
    if (!prev) {
      changedIndents.add(i.indentNo)
      continue
    }
    if (prev.status !== i.status) {
      changedIndents.add(i.indentNo)
      if (i.status === 'PO Done & GRN Received') newlyGrnDone++
      if (prev.status === 'Indent Only – No PO' && i.status === 'PO Raised – GRN Pending') newlyInProgress++
      if (i.status === 'PO Done & GRN Received' && prev.status !== 'PO Done & GRN Received') newlyComplete++
    }
  }
  const newlyOverdue = current.filter(i => i.status === 'Indent Only – No PO' && (i.worstAgeDays ?? 0) >= 7).length

  // ── Line-level diff (precise per-row NEW / UPDATED) ────────────
  const prevLineMap = new Map(previousLineStatuses.map(l => [l.id, l]))
  const newLineIds = new Set<string>()
  const changedLineIds = new Set<string>()
  for (const ln of currentLines) {
    const prev = prevLineMap.get(ln.id)
    if (!prev) {
      newLineIds.add(ln.id)
    } else if (prev.status !== ln.status || prev.pendingQty !== ln.pendingQty) {
      changedLineIds.add(ln.id)
    }
  }

  return {
    prevSavedAt: previousMeta.savedAt,
    prevFileName: previousMeta.fileName,
    changedIndents,
    newLineIds,
    changedLineIds,
    newlyGrnDone,
    newlyInProgress,
    newlyOverdue,
    newlyComplete,
  }
}

export function formatSavedAt(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  } catch { return iso }
}
