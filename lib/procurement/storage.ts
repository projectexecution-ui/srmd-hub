// Pure diff utility for the procurement tracker.
//
// Persistence itself now lives in Supabase (procurement_tracker_state +
// procurement_tracker_state_history) — see /api/procurement-tracker/state
// and the analyse route. This file used to manage localStorage; that
// pattern was replaced because Aksha wanted the Budget vs Actual
// model (one shared org-wide JSONB blob, no per-browser fragmentation).
//
// What survives here: computeDiff() and the saved-at formatter — both
// pure helpers with no storage side-effects.

import type {
  IndentRollup, LineRecord, IndentStatusSnapshot,
  LineStatusSnapshot, SnapshotDiff,
} from './types'

/**
 * Diff the current parse result against the last saved snapshot.
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
  const newlyOverdue = current.filter(i =>
    i.status === 'Indent Only – No PO' && (i.worstAgeDays ?? 0) >= 7
  ).length

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
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
  } catch { return iso }
}
