/** IN4's material name IS the item.
 *
 *  The earlier design tried to work out which of our 514 master items an IN4
 *  material name referred to. Only 1.3% matched exactly, so it guessed and asked
 *  a human to confirm every line — which is work, and a wrong confirmation is
 *  invisible afterwards. Aksha's call: follow IN4 as the base. An IN4 name is
 *  not a clue about an item, it is an item, carrying IN4's own name and UOM.
 *
 *  What actually turned up at the gate is a separate question, answered at the
 *  gate by the person looking at the truck — see `differs_from_po` on
 *  wh_gate_in_lines.
 */

/** The key that decides whether two IN4 names are the same item.
 *
 *  IN4 exports are full of stray punctuation and double spaces ("TMT Bars  8MM",
 *  "25MM : PVC CONDUITE"), and the same material comes through with different
 *  spacing on different weeks. Must stay in step with the wh_items_in4_key_idx
 *  expression, or the app and the database will disagree about what is one item. */
export function in4Key(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** IN4's name as it should be stored and shown.
 *
 *  IN4 wraps SOME material names in double quotes and not others — on one real
 *  PO, 5 of 7 came through as "KICH SS 316 Door Hinge …" and 2 bare. The quotes
 *  are an export artifact, not part of the name, and leaving them in makes the
 *  same material look like two different things on a register. Only the wrapping
 *  pair is removed; nothing inside the name is touched, because the name is
 *  IN4's to decide. */
export function in4Name(s: string): string {
  const v = s.trim()
  // [\s\S] rather than . with the /s flag: the project's TS target predates it.
  const m = v.match(/^(["'])([\s\S]*)\1$/)
  return (m ? m[2] : v).trim()
}

/** A UOM we can store. IN4 writes them loosely; blank means it did not say. */
export function cleanUom(s: string | null | undefined): string | null {
  const v = (s ?? '').trim()
  return v ? v : null
}

/** An IN4 line as it will become an item. */
export type In4ItemSpec = {
  /** IN4's text, trimmed but otherwise untouched — never re-worded. */
  name: string
  uom: string | null
  discipline: string | null
}

export type In4ItemPlan = {
  /** Distinct items this import needs, keyed by in4Key. */
  wanted: Map<string, In4ItemSpec>
  /** Lines IN4 sent with no material name at all — they cannot become items. */
  unnamed: number
}

/** Collapse the lines of a PO into the distinct items it refers to.
 *
 *  The tracker repeats a material once per indent, so the same name arrives
 *  several times on one PO; that is one item, and the ordered quantities add up
 *  elsewhere. Where IN4 sends the same name with two different UOMs, the first
 *  one wins and the conflict is reported rather than silently picked. */
export function planIn4Items(
  lines: Array<{ material?: string | null; uom?: string | null; discipline?: string | null }>,
): In4ItemPlan & { uomConflicts: Array<{ name: string; kept: string | null; alsoSeen: string }> } {
  const wanted = new Map<string, In4ItemSpec>()
  const uomConflicts: Array<{ name: string; kept: string | null; alsoSeen: string }> = []
  let unnamed = 0

  for (const l of lines) {
    const name = in4Name(l.material ?? '')
    if (!name) { unnamed++; continue }
    const key = in4Key(name)
    if (!key) { unnamed++; continue }

    const uom = cleanUom(l.uom)
    const cur = wanted.get(key)
    if (!cur) {
      wanted.set(key, { name, uom, discipline: l.discipline?.trim() || null })
      continue
    }
    if (uom && cur.uom && uom !== cur.uom) {
      uomConflicts.push({ name: cur.name, kept: cur.uom, alsoSeen: uom })
    } else if (uom && !cur.uom) {
      cur.uom = uom
    }
    if (!cur.discipline && l.discipline?.trim()) cur.discipline = l.discipline.trim()
  }

  return { wanted, unnamed, uomConflicts }
}

/** The unit an item gets when IN4 did not say.
 *
 *  `Nos` rather than a blank, because wh_items.unit is NOT NULL and a unit is
 *  locked to the item once set (#11) — an item with no unit could not be
 *  received at all. Flagged in the import summary so it can be corrected before
 *  anybody counts it. */
export const FALLBACK_UOM = 'Nos'

export type EnsureResult = {
  /** in4Key → item id, for every line of the import. */
  byKey: Map<string, string>
  created: string[]
  reused: string[]
  /** IN4 sent a UOM that disagrees with the unit we already hold for this item.
   *  Not corrected automatically: changing a live item's unit re-scales its
   *  whole stock history. */
  unitMismatches: Array<{ name: string; ours: string; in4: string }>
  missingUom: string[]
}
