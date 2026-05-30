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
  ParseResult, IndentRollup, IndentStatusSnapshot,
  StoredSnapshot, SnapshotDiff, TrendPoint,
} from './types'

const KEY = 'ct-procurement-tracker-v1'

interface Stored {
  current?: StoredSnapshot
  previousIndents?: IndentStatusSnapshot[]
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
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* quota — drop silently */ }
}

export function loadStoredSnapshot(): StoredSnapshot | null {
  return readAll()?.current ?? null
}

export function loadPreviousIndents(): IndentStatusSnapshot[] {
  return readAll()?.previousIndents ?? []
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
  const all = result.projects.flatMap(p => p.indents)
  const indentStatuses: IndentStatusSnapshot[] = all.map(i => ({
    indentNo: i.indentNo,
    status: i.status,
    pendingValue: i.pendingValue,
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
    },
    // The PREVIOUS upload becomes the diff baseline for the NEXT one we make.
    previousIndents: prev.current?.indentStatuses ?? [],
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
 */
export function computeDiff(
  current: IndentRollup[],
  previousIndents: IndentStatusSnapshot[],
  previousMeta: { savedAt: string; fileName: string } | null,
): SnapshotDiff | null {
  if (!previousMeta || previousIndents.length === 0) return null
  const prevMap = new Map(previousIndents.map(p => [p.indentNo, p]))
  const changed = new Set<string>()
  let newlyGrnDone = 0
  let newlyInProgress = 0
  let newlyOverdue = 0
  let newlyComplete = 0

  for (const i of current) {
    const prev = prevMap.get(i.indentNo)
    if (!prev) {
      // New indent in this upload — count it as a change but no transition info
      changed.add(i.indentNo)
      continue
    }
    if (prev.status !== i.status) {
      changed.add(i.indentNo)
      if (i.status === 'PO Done & GRN Received') newlyGrnDone++
      if (prev.status === 'Indent Only – No PO' && i.status === 'PO Raised – GRN Pending') newlyInProgress++
      if (i.status === 'PO Done & GRN Received' && prev.status !== 'PO Done & GRN Received') newlyComplete++
    }
    // Also flag as "newlyOverdue" when its worst age crosses 7d but status is still pending
    if ((i.worstAgeDays ?? 0) >= 7 && i.status === 'Indent Only – No PO') {
      // It was probably already overdue; flag only if previous was < 7d (we don't know prev age, so heuristic: flag any current ≥7d in pending)
      // Skip this signal to avoid noise. Worst-offender vendor card already surfaces it.
    }
  }
  // Newly overdue heuristic: lines that are still in "Indent Only – No PO" and changed (rare)
  newlyOverdue = current.filter(i => i.status === 'Indent Only – No PO' && (i.worstAgeDays ?? 0) >= 7).length

  return {
    prevSavedAt: previousMeta.savedAt,
    prevFileName: previousMeta.fileName,
    changedIndents: changed,
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
