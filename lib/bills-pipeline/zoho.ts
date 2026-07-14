import type { SupabaseClient } from '@supabase/supabase-js'
import { BP_CONFIG } from './config'

const DC = process.env.ZOHO_DC ?? 'in'

function apiBase(): string {
  return DC === 'com'
    ? 'https://projectsapi.zoho.com/api/v3'
    : BP_CONFIG.ZOHO_API_BASE
}

function tokenUrl(): string {
  return DC === 'com'
    ? 'https://accounts.zoho.com/oauth/v2/token'
    : BP_CONFIG.ZOHO_TOKEN_URL
}

export async function getZohoToken(supabase: SupabaseClient): Promise<string> {
  // Prefer token stored in DB (set by the in-app OAuth flow), fall back to env
  const { data: row } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'zoho_bp_refresh_token')
    .maybeSingle()

  const refreshToken = (row?.value as string | null) ?? process.env.ZOHO_BP_REFRESH_TOKEN

  if (!refreshToken) {
    throw new Error(
      'No Zoho refresh token found — visit /bills-pipeline and click "Connect Zoho".',
    )
  }

  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     process.env.ZOHO_BP_CLIENT_ID ?? '',
    client_secret: process.env.ZOHO_BP_CLIENT_SECRET ?? '',
  })

  const res = await fetch(tokenUrl(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Zoho token refresh failed (${res.status}): ${text}`)
  }

  const json = await res.json()
  if (!json.access_token) {
    throw new Error(`Zoho token response missing access_token: ${JSON.stringify(json)}`)
  }
  return json.access_token as string
}

// A Zoho money field: { amount, formatted_amount, currency_code }
export interface ZohoMoney {
  amount?: number
  formatted_amount?: string
}

// Raw v3 task shape — only the fields we consume. Custom fields are FLATTENED
// as top-level keys (not a custom_fields[] array).
export interface ZohoTask {
  id:                 string
  prefix?:            string   // human task ref, e.g. "B-2-T5"
  name:               string
  start_date?:        string
  status?:            { name?: string; is_closed_type?: boolean }
  is_completed?:      boolean
  created_time?:      string
  last_modified_time?: string
  completed_on?:      string
  tasklist?:          { name?: string }
  // flattened custom fields
  vendor_from_module_2?: { value?: string }
  wo_po_no?:          string
  order_type?:        string
  bill_number?:       string
  task_cf_0002?:      string   // RA number
  bill_type?:         string
  bill_date?:         string
  this_bill_amt?:            ZohoMoney   // claimed
  certified_payment_amount?: ZohoMoney
  paid_till_date?:           ZohoMoney
}

interface ProjectResult {
  project: string
  tasks:   ZohoTask[]
  error?:  string
}

// Zoho's v3 base path has been seen written both as /portal/ and /portals/.
// Probe once, cache the winner, so we don't 404 on a guess.
let RESOLVED_SEGMENT: 'portal' | 'portals' | null = null

async function fetchTasksPage(
  token: string, projectId: string, page: number,
): Promise<{ tasks: ZohoTask[]; hasNext: boolean }> {
  const base = apiBase()
  const segments: Array<'portal' | 'portals'> =
    RESOLVED_SEGMENT ? [RESOLVED_SEGMENT] : ['portal', 'portals']

  let lastErr = ''
  for (const seg of segments) {
    const url = `${base}/${seg}/${BP_CONFIG.PORTAL_ID}/projects/${projectId}/tasks`
      + `?page=${page}&per_page=${BP_CONFIG.PAGE_SIZE}`
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    })

    if (res.status === 404) { lastErr = `404 on /${seg}/`; continue }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Zoho tasks fetch failed for ${projectId} (${res.status}): ${text}`)
    }

    RESOLVED_SEGMENT = seg
    const json = await res.json()
    // v3 wraps in data{}, but tolerate a flat shape too
    const container = json.data ?? json
    const tasks: ZohoTask[] = container.tasks ?? []
    const hasNext = !!container.page_info?.has_next_page
    return { tasks, hasNext }
  }
  throw new Error(`Zoho tasks fetch failed for ${projectId}: ${lastErr || 'unknown'}`)
}

async function fetchProjectTasks(token: string, projectId: string): Promise<ZohoTask[]> {
  const tasks: ZohoTask[] = []
  let page = 1
  const PAGE_CAP = 20

  while (page <= PAGE_CAP) {
    const { tasks: batch, hasNext } = await fetchTasksPage(token, projectId, page)
    tasks.push(...batch)
    if (!hasNext) break
    page++
  }
  return tasks
}

export async function fetchAllTasks(
  token: string,
  projects: Array<{ code: string; id: string }>,
): Promise<ProjectResult[]> {
  const settled = await Promise.allSettled(
    projects.map(async p => {
      const tasks = await fetchProjectTasks(token, p.id)
      return { project: p.code, tasks }
    }),
  )

  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
    console.warn(`[bills-pipeline] Failed to fetch project ${projects[i].code}:`, msg)
    return { project: projects[i].code, tasks: [], error: msg }
  })
}

// All billing projects in the portal (name starts with "Billing") — powers the
// admin project picker. Returns {id, name}; the caller derives a short code.
export async function fetchBillingProjects(token: string): Promise<Array<{ id: string; name: string }>> {
  const base = apiBase()
  const segments: Array<'portal' | 'portals'> = RESOLVED_SEGMENT ? [RESOLVED_SEGMENT] : ['portal', 'portals']
  let lastErr = ''
  for (const seg of segments) {
    const url = `${base}/${seg}/${BP_CONFIG.PORTAL_ID}/projects?page=1&per_page=200`
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } })
    if (res.status === 404) { lastErr = `404 on /${seg}/`; continue }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Zoho projects fetch failed (${res.status}): ${text}`)
    }
    RESOLVED_SEGMENT = seg
    const json = await res.json()
    const container = json.data ?? json
    const list: Array<{ id: string; name: string }> = container.result ?? container.projects ?? []
    return list
      .map(p => ({ id: String(p.id), name: String(p.name ?? '') }))
      .filter(p => /billing/i.test(p.name))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  throw new Error(`Zoho projects fetch failed: ${lastErr || 'unknown'}`)
}

export async function fetchTaskComments(
  token: string, projectId: string, taskId: string,
): Promise<string[]> {
  try {
    const seg = RESOLVED_SEGMENT ?? 'portal'
    const url = `${apiBase()}/${seg}/${BP_CONFIG.PORTAL_ID}/projects/${projectId}/tasks/${taskId}/comments`
    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    })
    if (!res.ok) return []
    const json = await res.json()
    const container = json.data ?? json
    const comments: Array<{ content?: string; added_time?: string }> = container.comments ?? []
    return comments
      .sort((a, b) => new Date(b.added_time ?? 0).getTime() - new Date(a.added_time ?? 0).getTime())
      .map(c => c.content ?? '')
  } catch {
    return []
  }
}
