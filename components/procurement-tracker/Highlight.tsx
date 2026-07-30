// Wraps the parts of `text` that match `query` in a subtle amber mark, so a
// search result shows *why* it matched. Case-insensitive; renders plain text
// (no highlight) when the query is empty. Query is escaped so stray regex
// characters from a user's search never throw.
import { Fragment } from 'react'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'))
  const lower = q.toLowerCase()
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lower
          ? <mark key={i} className="bg-amber-200/70 text-inherit rounded-[2px] px-0.5">{part}</mark>
          : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  )
}
