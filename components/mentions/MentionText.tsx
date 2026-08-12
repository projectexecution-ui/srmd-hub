// Renders comment text with @mentions highlighted. Pure (no client APIs) so it
// works inside server or client components — the parent passes the mentionable
// users so a whole thread resolves them in one fetch.

import { splitMentions, type MentionUser } from '@/lib/mentions/parse'

export function MentionText({ text, users }: { text: string; users: MentionUser[] }) {
  const segs = splitMentions(text, users)
  return (
    <>
      {segs.map((s, i) =>
        s.type === 'mention'
          ? <span key={i} className="font-semibold text-blue-700 bg-blue-50 rounded px-0.5">{s.value}</span>
          : <span key={i}>{s.value}</span>,
      )}
    </>
  )
}
