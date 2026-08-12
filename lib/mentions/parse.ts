// Shared @-mention parsing — pure + unit-tested, used by the mention textarea,
// the highlighted display, and the notify path.
//
// A mention is stored plainly in the comment text as "@Full Name" (readable),
// while the picked user IDs are captured at compose time and carried alongside
// for notification. For DISPLAY we re-highlight any "@Full Name" that matches a
// known active user — longest names first so "@Parimal Srmd" wins over "@Parimal".

export interface MentionUser {
  id: string
  name: string
}

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; id: string | null }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Split text into plain + mention segments, given the set of mentionable users.
 *  Matches "@<name>" for the known names, preferring the longest name. */
export function splitMentions(text: string, users: MentionUser[]): Segment[] {
  if (!text) return [{ type: 'text', value: '' }]
  const names = [...users].sort((a, b) => b.name.length - a.name.length)
  if (names.length === 0) return [{ type: 'text', value: text }]

  const idByName = new Map(names.map(u => [u.name, u.id]))
  // One alternation of all names, longest first, each preceded by "@".
  const pattern = new RegExp('@(' + names.map(u => escapeRegExp(u.name)).join('|') + ')', 'g')

  const out: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
    out.push({ type: 'mention', value: '@' + m[1], id: idByName.get(m[1]) ?? null })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out.length ? out : [{ type: 'text', value: text }]
}

/** Which of the picked mention IDs are actually still present in the text
 *  (a user may pick then delete the @name). Returns a deduped id list. */
export function activeMentionIds(text: string, picked: MentionUser[]): string[] {
  const present = new Set<string>()
  for (const u of picked) {
    if (u.id && text.includes('@' + u.name)) present.add(u.id)
  }
  return [...present]
}

/** All user IDs mentioned in the text (derived purely from text + known users,
 *  so it works whether the @name was picked, typed, or pasted). Deduped. */
export function mentionIdsInText(text: string, users: MentionUser[]): string[] {
  const ids = new Set<string>()
  for (const s of splitMentions(text, users)) {
    if (s.type === 'mention' && s.id) ids.add(s.id)
  }
  return [...ids]
}

/** The token inserted when a user is picked from the @ dropdown. */
export function mentionToken(name: string): string {
  return '@' + name + ' '
}
