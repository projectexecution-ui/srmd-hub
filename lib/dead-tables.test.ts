import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Tables the shared database no longer has.
 *
 *  Checked against information_schema on 14 Sep 2026. Nine of the ten tables
 *  AGENTS.md still lists under "Tables you'll touch" have been dropped; only
 *  `zoho_tokens` survives, and that one is excluded from this UI anyway.
 *
 *  This test exists because of a real outage. `/bills-booking` and every bill
 *  page under it selected `vendors(name)` as a PostgREST embed. `vendors` does
 *  not exist, so the query came back
 *
 *      Could not find a relationship between 'bb_bills' and 'vendors'
 *
 *  — the list showed an error banner, and every single bill 404'd, because a
 *  null row hits notFound().
 *
 *  Nothing else catches this. TypeScript cannot: a select is a string. The
 *  build cannot: nothing runs. And checking the data in SQL cannot either —
 *  SQL does not go through PostgREST, so an embed that cannot resolve looks
 *  perfectly healthy from there. That was the actual mistake: the figures were
 *  verified, the query path never was.
 *
 *  A string match is crude. It is also the only check that runs on every commit
 *  without a database connection. */
const DROPPED = [
  'vendors', 'purchase_orders', 'grns', 'invoices', 'payments',
  'indents', 'indent_lines', 'po_lines', 'uploads',
]

/** The one place that still reaches for them, and why it is not an outage.
 *
 *  The Dashboard's old procurement strip queries indents, purchase_orders,
 *  grns and invoices and embeds vendors. Every one of those calls sits behind
 *  `canShow('indents')` and friends, and there is no `role_permissions` row for
 *  any of those four slugs — a missing row reads as off — so none of them ever
 *  runs and nobody sees an error.
 *
 *  It is left alone rather than quietly rewritten: it belongs to another
 *  module, it is invisible today, and deleting somebody's dashboard block is
 *  not a thing to slip into a bills fix. It IS a landmine — grant one of those
 *  permissions and the home page breaks — so it is written down here instead of
 *  being forgotten, and this test fails the moment anything NEW joins it. */
const KNOWN_GATED_OFF = new Set([
  'app/(app)/dashboard/page.tsx',
])

const ROOTS = ['app', 'lib', 'components']
const SKIP = new Set(['node_modules', '.next', 'dist', 'out'])

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

const files = ROOTS.flatMap(r => {
  try { return sources(r) } catch { return [] }
})

describe('no code talks to a table the database dropped', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  for (const table of DROPPED) {
    it(`never queries or embeds "${table}"`, () => {
      // .from('x')  — a query against the table
      // x(a, b)     — a PostgREST embed, which only means anything in a select
      const from = new RegExp(String.raw`\.from\(\s*['"\`]` + table + String.raw`['"\`]`)
      const embed = new RegExp(String.raw`[,'"\`(]\s*` + table + String.raw`\s*\([a-z_,\s]*\)`)

      const hits: string[] = []
      for (const f of files) {
        const rel = f.split('\\').join('/')
        if (KNOWN_GATED_OFF.has(rel)) continue
        readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (from.test(line) || (embed.test(line) && /select\(/.test(line))) {
            hits.push(`${rel}:${i + 1}`)
          }
        })
      }
      expect(hits, `"${table}" was dropped from the database, so these fail at runtime:\n${hits.join('\n')}`).toEqual([])
    })
  }
})
