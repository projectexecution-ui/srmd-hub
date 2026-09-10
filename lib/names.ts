// The name layer, Phase 1 (Aksha, 10 Sep 2026): the few pure rules for what a
// screen SHOWS, kept apart from what the code MATCHES on.
//
// Identity is IN4's text and the project's code; display is a CT Hub choice
// stored beside it. Nothing in this file may be used as a key — a matcher that
// read a display name would move money when someone changed a label.

/** IN4 prefixes its category code onto the name: "03 Civil", "602 Fittings".
 *  People read "Civil"; the tree keeps the code as its SORT key. Also drops the
 *  "N Spl"-style abbreviations IN4 stores in short_name — those are not names. */
export function skillLabel(name: string | null | undefined): string {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim()
  return s.replace(/^\d{1,4}\s+(?=\S)/, '').trim() || s
}

/** The chip on a project: its short name when set, else its code. The code is
 *  still the code — Working-Sheet numbers and matching never see this. */
export function projectChip(shortName: string | null | undefined, code: string | null | undefined): string {
  const s = (shortName ?? '').trim()
  return s || (code ?? '').trim()
}

/** The band label over a group of projects: an explicit group label, else the
 *  group project's chip, else its name. Same chain as before with short_name
 *  slotted in after group_label, so nothing that reads a band today changes. */
export function groupBand(
  p: { group_label?: string | null; short_name?: string | null; code?: string | null; name?: string | null },
): string {
  return (p.group_label ?? '').trim() || projectChip(p.short_name, p.code) || (p.name ?? '').trim()
}
