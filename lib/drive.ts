// Google Drive, from the server, with a service account — no library.
//
// Why a service account: the archive has to run unattended from Vercel (the
// cron), so it cannot ride on a person's Google login. A service account is a
// robot identity Aksha shares the folder with once; from then on it can write
// there and nowhere else.
//
// Why no library: googleapis is ~30 MB and we need four calls — token, find or
// create a folder, upload a file, move a file. The JWT is signed with Node's
// own crypto. Everything is env-gated: without GOOGLE_SERVICE_ACCOUNT_JSON and
// GDRIVE_ROOT_FOLDER_ID this module reports "not configured" and does nothing.

import { createSign } from 'node:crypto'

export interface DriveConfig { clientEmail: string; privateKey: string; rootFolderId: string }

export function driveConfig(): DriveConfig | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  const root = process.env.GDRIVE_ROOT_FOLDER_ID
  if (!raw || !root) return null
  try {
    const j = JSON.parse(raw) as { client_email?: string; private_key?: string }
    if (!j.client_email || !j.private_key) return null
    return { clientEmail: j.client_email, privateKey: j.private_key.replace(/\\n/g, '\n'), rootFolderId: root }
  } catch { return null }
}

const b64url = (s: Buffer | string) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

let token: { value: string; exp: number } | null = null

/** OAuth2 access token for the service account (cached until a minute before expiry). */
export async function driveToken(cfg: DriveConfig): Promise<string> {
  if (token && token.exp - 60_000 > Date.now()) return token.value
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: cfg.clientEmail, scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256'); signer.update(`${header}.${claims}`)
  const jwt = `${header}.${claims}.${b64url(signer.sign(cfg.privateKey))}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!res.ok) throw new Error(`Drive token: ${res.status} ${await res.text()}`)
  const j = await res.json() as { access_token: string; expires_in: number }
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 }
  return token.value
}

const API = 'https://www.googleapis.com/drive/v3'
// supportsAllDrives is what lets the calls work inside a Shared drive.
const Q = 'supportsAllDrives=true&includeItemsFromAllDrives=true'

async function api<T>(cfg: DriveConfig, path: string, init: RequestInit = {}): Promise<T> {
  const t = await driveToken(cfg)
  const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}${Q}`, {
    ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
  })
  if (!res.ok) throw new Error(`Drive ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Find-or-create a folder by name under a parent. */
export async function ensureFolder(cfg: DriveConfig, parentId: string, name: string): Promise<string> {
  const q = encodeURIComponent(`name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`)
  const found = await api<{ files: Array<{ id: string }> }>(cfg, `/files?q=${q}&fields=files(id)&pageSize=1`)
  if (found.files[0]) return found.files[0].id
  const made = await api<{ id: string }>(cfg, `/files?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  return made.id
}

/** Find-or-create a whole path like ["01 IN4 reports", "BPH", "2026", "2026-09"]. */
export async function ensureFolderPath(cfg: DriveConfig, segments: string[]): Promise<string> {
  let parent = cfg.rootFolderId
  for (const seg of segments) parent = await ensureFolder(cfg, parent, seg)
  return parent
}

/** Upload bytes as a new file (multipart, fine up to ~5 MB per request; the
 *  hub's uploads are Excel sheets and photos, all well under that). */
export async function uploadFile(cfg: DriveConfig, folderId: string, name: string, mimeType: string, bytes: Buffer, description?: string): Promise<{ id: string; webViewLink: string }> {
  const boundary = `srmd${Date.now().toString(36)}`
  const meta = JSON.stringify({ name, parents: [folderId], description })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  const t = await driveToken(cfg)
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&${Q}`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  })
  if (!res.ok) throw new Error(`Drive upload ${name}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<{ id: string; webViewLink: string }>
}

/** Move a file to another folder (used for Archive/ on delete) and optionally rename it. */
export async function moveFile(cfg: DriveConfig, fileId: string, fromFolderId: string, toFolderId: string, newName?: string): Promise<void> {
  await api(cfg, `/files/${fileId}?addParents=${toFolderId}&removeParents=${fromFolderId}&fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newName ? { name: newName } : {}),
  })
}

/** "2026-09-04_0912" in IST — the prefix every archived file carries. */
export function istStamp(d = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}_${p(ist.getUTCHours())}${p(ist.getUTCMinutes())}`
}
/** Year and month folders for a date, IST. */
export function istYearMonth(d = new Date()): { year: string; month: string } {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000)
  const y = String(ist.getUTCFullYear()); const m = `${y}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`
  return { year: y, month: m }
}
/** Drive rejects "/" in names; keep everything else readable. */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180)
}
