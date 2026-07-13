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

// Raw Zoho task shape — only the fields we use
export interface ZohoTask {
  id:               string
  name:             string
  status:           { name: string }
  created_time:     string   // ISO or epoch-ms string
  last_updated_time: string
  tasklist:         { name: string }
  custom_fields?:   Array<{ label: string; value: string | number | null }>
}

interface ProjectResult {
  project: string
  tasks:   ZohoTask[]
}

async function fetchProjectTasks(token: string, projectId: string): Promise<ZohoTask[]> {
  const base   = apiBase()
  const tasks: ZohoTask[] = []
  let   page   = 1
  const PAGE_CAP = 20

  while (page <= PAGE_CAP) {
    const url = `${base}/portal/${BP_CONFIG.PORTAL_ID}/projects/${projectId}/tasks/`
      + `?page=${page}&page_size=${BP_CONFIG.PAGE_SIZE}&include_subtask=false`

    const res = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Zoho tasks fetch failed for project ${projectId} (${res.status}): ${text}`)
    }

    const json = await res.json()
    const batch: ZohoTask[] = json.tasks ?? []
    tasks.push(...batch)

    if (!json.page_info?.has_next_page) break
    page++
  }

  return tasks
}

export async function fetchAllTasks(token: string): Promise<ProjectResult[]> {
  const entries = Object.entries(BP_CONFIG.PROJECTS) as [string, string][]

  const settled = await Promise.allSettled(
    entries.map(async ([project, id]) => {
      const tasks = await fetchProjectTasks(token, id)
      return { project, tasks }
    }),
  )

  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    console.warn(`[bills-pipeline] Failed to fetch project ${entries[i][0]}:`, r.reason)
    return { project: entries[i][0], tasks: [] }
  })
}

export async function fetchTaskComments(
  token: string,
  projectId: string,
  taskId: string,
): Promise<string[]> {
  try {
    const url = `${apiBase()}/portal/${BP_CONFIG.PORTAL_ID}/projects/${projectId}/tasks/${taskId}/comments/`
    const res  = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    })
    if (!res.ok) return []
    const json = await res.json()
    const comments: Array<{ content: string; added_time: string }> = json.comments ?? []
    // Newest first
    return comments
      .sort((a, b) => new Date(b.added_time).getTime() - new Date(a.added_time).getTime())
      .map(c => c.content ?? '')
  } catch {
    return []
  }
}
