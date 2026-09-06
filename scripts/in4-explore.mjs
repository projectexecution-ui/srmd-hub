#!/usr/bin/env node
/**
 * Read-only reconnaissance of the IN4 (In4Suite) SQL Server database.
 *
 * WHY THIS EXISTS
 * IN4 reaches CT Hub today as four Excel reports somebody downloads and uploads
 * by hand (see `lib/in4-parser.ts`). With direct database access, those become a
 * scheduled pull — but only once we know which tables and views hold the same
 * figures. Guessing is exactly what `feedback_dont_guess_follow_the_source`
 * says not to do, so this script goes and looks.
 *
 * WHAT IT DOES *NOT* DO
 * Nothing but SELECT, and only against the catalogue views plus TOP-N samples.
 * It writes nothing, creates nothing, and drops nothing. Run it with a
 * READ-ONLY login — if the credentials can write, they are the wrong
 * credentials for this job.
 *
 * USAGE
 *   1. Put the credentials in `.env.in4.local` beside package.json (gitignored):
 *        IN4_DB_HOST=mssql-rds.srmd.org
 *        IN4_DB_PORT=2609
 *        IN4_DB_NAME=<database>
 *        IN4_DB_USER=<read-only user>
 *        IN4_DB_PASSWORD=<password>
 *   2. npm i -D mssql dotenv
 *   3. node scripts/in4-explore.mjs                 # the overview
 *      node scripts/in4-explore.mjs --like budget   # tables whose name matches
 *      node scripts/in4-explore.mjs --cols PO_Header
 *      node scripts/in4-explore.mjs --sample PO_Header
 *
 * Output goes to stdout as Markdown so it can be pasted straight back here.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Tiny .env reader — one less dependency, and it never touches process.env
 *  entries that are already set (so CI or a shell export still wins). */
function loadEnv(file) {
  let text
  try { text = readFileSync(resolve(ROOT, file), 'utf8') }
  catch { return false }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
  return true
}

loadEnv('.env.in4.local') || loadEnv('.env.local') || loadEnv('.env')

const CFG = {
  server: process.env.IN4_DB_HOST,
  port: Number(process.env.IN4_DB_PORT ?? 1433),
  database: process.env.IN4_DB_NAME,
  user: process.env.IN4_DB_USER,
  password: process.env.IN4_DB_PASSWORD,
  options: {
    // RDS presents a certificate that will not chain to a store we control, so
    // encryption stays ON and only the chain check is relaxed. Never the other
    // way round: unencrypted would put the password on the wire in the clear.
    encrypt: true,
    trustServerCertificate: true,
    // A read-only session, declared. SQL Server will refuse writes outright on
    // an Availability Group replica, and it documents the intent regardless.
    readOnlyIntent: true,
  },
  connectionTimeout: 20_000,
  requestTimeout: 60_000,
}

const missing = ['IN4_DB_HOST', 'IN4_DB_NAME', 'IN4_DB_USER', 'IN4_DB_PASSWORD']
  .filter(k => !process.env[k])
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`)
  console.error('Put them in .env.in4.local beside package.json — see the header of this file.')
  process.exit(1)
}

let sql
try { sql = (await import('mssql')).default }
catch {
  console.error('The mssql driver is not installed yet. Run:  npm i -D mssql')
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : (args[i + 1] ?? '')
}

const q = (pool, text, params = {}) => {
  const r = pool.request()
  for (const [k, v] of Object.entries(params)) r.input(k, v)
  return r.query(text)
}

const md = rows => {
  if (rows.length === 0) return '_nothing_\n'
  const cols = Object.keys(rows[0])
  const cell = v => v === null ? '—'
    : v instanceof Date ? v.toISOString().slice(0, 10)
    : String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 60)
  return [
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${cols.map(c => cell(r[c])).join(' | ')} |`),
  ].join('\n') + '\n'
}

const pool = await new sql.ConnectionPool(CFG).connect()

try {
  const ver = await q(pool, 'SELECT @@VERSION AS v, DB_NAME() AS db, SUSER_SNAME() AS login')
  const { v, db, login } = ver.recordset[0]
  console.log(`## Connected\n`)
  console.log(`- **Database:** ${db}`)
  console.log(`- **Logged in as:** ${login}`)
  console.log(`- **Server:** ${String(v).split('\n')[0].trim()}\n`)

  // Can this login write? If yes, say so loudly — it is the wrong login.
  const perm = await q(pool, `
    SELECT permission_name FROM fn_my_permissions(NULL, 'DATABASE')
    WHERE permission_name IN ('INSERT','UPDATE','DELETE','ALTER','CONTROL')`)
  if (perm.recordset.length > 0) {
    console.log(`> **This login can ${perm.recordset.map(r => r.permission_name).join(', ')}.**`)
    console.log(`> A sync only ever needs SELECT. Ask for a read-only user before going further.\n`)
  } else {
    console.log(`- **Write permissions:** none found — good, this is a read-only login\n`)
  }

  const like = flag('like')
  const cols = flag('cols')
  const sample = flag('sample')

  if (cols) {
    console.log(`## Columns of \`${cols}\`\n`)
    const r = await q(pool, `
      SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH AS len,
             c.IS_NULLABLE AS nullable
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_NAME = @t
      ORDER BY c.ORDINAL_POSITION`, { t: cols })
    console.log(md(r.recordset))
  } else if (sample) {
    // Bracket-quoted after a strict identifier check — a table name cannot be
    // a bound parameter, so it is validated rather than interpolated blindly.
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(sample)) {
      console.error('That does not look like a table name.'); process.exit(1)
    }
    console.log(`## First 5 rows of \`${sample}\`\n`)
    const r = await q(pool, `SELECT TOP 5 * FROM [${sample}]`)
    console.log(md(r.recordset))
  } else {
    console.log(`## Tables and views${like ? ` matching "${like}"` : ''}, biggest first\n`)
    // Row counts from sys.partitions rather than COUNT(*) — instant, and an
    // ERP table can hold millions.
    const r = await q(pool, `
      SELECT TOP 200
             s.name AS [schema], t.name AS [table], t.type_desc AS kind,
             ISNULL(SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows END), 0) AS [rows]
      FROM sys.objects t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      LEFT JOIN sys.partitions p ON p.object_id = t.object_id
      WHERE t.type IN ('U','V')
        AND (@like = '' OR t.name LIKE '%' + @like + '%')
      GROUP BY s.name, t.name, t.type_desc
      ORDER BY [rows] DESC, t.name`, { like: like ?? '' })
    console.log(md(r.recordset))
    console.log(`\n_${r.recordset.length} shown. Narrow with \`--like budget\`, then \`--cols <table>\`._`)
  }
} finally {
  await pool.close()
}
