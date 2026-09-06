// The one place CT Hub talks to IN4's SQL Server.
//
// Read-only by construction: the login is read-only (verified with
// fn_my_permissions on 4 Sept 2026), the session declares readOnlyIntent, and
// nothing in lib/in4 ever builds anything but a SELECT. Encryption stays ON
// with the RDS certificate chain trusted, never the other way round — an
// unencrypted connection would put the password on the wire in the clear.
//
// Server-only. The pool is module-scoped so a warm serverless instance reuses
// it; a cold one pays the ~200 ms Mumbai → Virginia handshake once.

import sql from 'mssql'

export interface In4Config {
  server: string
  port: number
  database: string
  user: string
  password: string
}

/** Host, port and database name are not secrets and never change (the RDS
 *  endpoint and the one database, In4re); they default so only the login has to
 *  be set. Present only where IN4_DB_USER and IN4_DB_PASSWORD are — locally via
 *  .env.in4.local, on Vercel via project environment variables. */
export const IN4_DEFAULTS = { host: 'mssql-rds.srmd.org', port: 2609, database: 'In4re' }

export function in4Config(): In4Config | null {
  const { IN4_DB_HOST, IN4_DB_PORT, IN4_DB_NAME, IN4_DB_USER, IN4_DB_PASSWORD } = process.env
  if (!IN4_DB_USER || !IN4_DB_PASSWORD) return null
  return {
    server: IN4_DB_HOST?.trim() || IN4_DEFAULTS.host,
    port: Number(IN4_DB_PORT?.trim() || IN4_DEFAULTS.port),
    database: IN4_DB_NAME?.trim() || IN4_DEFAULTS.database,
    user: IN4_DB_USER.trim(), password: IN4_DB_PASSWORD,
  }
}

/** Which of the variables the deployment is missing — for the admin screen. */
export function in4MissingVars(): string[] {
  return ['IN4_DB_USER', 'IN4_DB_PASSWORD'].filter(k => !process.env[k])
}

let pool: Promise<sql.ConnectionPool> | null = null

export function in4Pool(): Promise<sql.ConnectionPool> {
  const cfg = in4Config()
  if (!cfg) throw new Error('IN4 is not configured — set IN4_DB_USER and IN4_DB_PASSWORD (host, port and database default to the RDS endpoint and In4re).')
  if (pool) return pool
  const next: Promise<sql.ConnectionPool> = new sql.ConnectionPool({
      server: cfg.server,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      options: { encrypt: true, trustServerCertificate: true, readOnlyIntent: true },
      connectionTimeout: 20_000,
      requestTimeout: 120_000,
      pool: { max: 3, min: 0, idleTimeoutMillis: 30_000 },
    }).connect().catch((e: unknown) => { pool = null; throw e })
  pool = next
  return next
}

/** Run one SELECT. Refuses anything else, so a future edit cannot turn this
 *  module into a write path by accident. */
export async function in4Query<T = Record<string, unknown>>(text: string): Promise<T[]> {
  if (!/^\s*(select|with)\b/i.test(text)) throw new Error('lib/in4 only runs SELECT statements')
  const p = await in4Pool()
  const r = await p.request().query<T>(text)
  return r.recordset
}
