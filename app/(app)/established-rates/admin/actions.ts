'use server'
// Server actions for IN4 imports.
//
// Both actions accept a base64-encoded .xlsx (sent from the client). We parse
// with xlsx and feed rows into the helpers in lib/in4-parser.ts, then upsert
// into est_* tables. All inserts are best-effort — failures are logged into
// est_upload_log.error_log rather than aborting the whole import.

import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import {
  extractFromAbstract, extractWoDetailRow, classifyAsContractor, shortenName,
} from '@/lib/in4-parser'

type ImportResult = {
  ok: boolean
  message: string
  stats: {
    disciplines: number
    categories: number
    subcategories: number
    rates: number
    wo_history: number
    skipped: number
    rows_total: number
  }
}

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data: profile } = await supabase.from('profiles')
    .select('id, role, is_portal_owner')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profile not found')
  const isAdmin = profile.role === 'admin' || profile.is_portal_owner
  if (!isAdmin) throw new Error('Only admin or Portal Owner can import')
  return { supabase, profile }
}

// ─── IN4 Abstract Report ─────────────────────────────────────
export async function importIn4Abstract(formData: FormData): Promise<ImportResult> {
  const file = formData.get('file') as File | null
  if (!file) return { ok: false, message: 'No file', stats: emptyStats() }

  const { supabase, profile } = await getProfile()

  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(ws, { header: 1, raw: false })

  const extract = extractFromAbstract(rows)
  const errors: string[] = []
  const stats = { ...emptyStats() }
  stats.rows_total = rows.length

  // Load existing taxonomy + parties + projects so we don't re-create
  const [discRes, catRes, subRes, vendorRes, contractorRes, projectsRes] = await Promise.all([
    supabase.from('est_disciplines').select('id, code, name'),
    supabase.from('est_categories').select('id, discipline_id, code, name'),
    supabase.from('est_subcategories').select('id, category_id, name'),
    supabase.from('vendors').select('id, name'),
    supabase.from('jmr_contractors').select('id, name'),
    supabase.from('projects').select('id, code, name, parent_project_id'),
  ])

  const discByCode = new Map<string, string>(
    (discRes.data ?? []).map(d => [String(d.code ?? '').toLowerCase(), d.id]),
  )
  const catByKey = new Map<string, string>(
    (catRes.data ?? []).map(c => [`${c.discipline_id}|${String(c.code ?? '').toLowerCase()}`, c.id]),
  )
  const subByKey = new Map<string, string>(
    (subRes.data ?? []).map(s => [`${s.category_id}|${s.name.toLowerCase()}`, s.id]),
  )
  const vendorByName = new Map<string, string>(
    (vendorRes.data ?? []).map(v => [v.name.toLowerCase(), v.id]),
  )
  const contractorByName = new Map<string, string>(
    (contractorRes.data ?? []).map(c => [c.name.toLowerCase(), c.id]),
  )

  // Project lookup: match by name OR code. Prefer sub-project (parent_project_id IS NOT NULL)
  // when both a parent and a sub-project share a name.
  const projectsAll = projectsRes.data ?? []
  const projectByName = new Map<string, string>()
  // Two-pass: sub-projects first (they win on a tie), then parents.
  for (const p of projectsAll) {
    if (p.parent_project_id) projectByName.set(p.name.toLowerCase(), p.id)
  }
  for (const p of projectsAll) {
    const k = p.name.toLowerCase()
    if (!projectByName.has(k)) projectByName.set(k, p.id)
    if (p.code) {
      const ck = p.code.toLowerCase()
      if (!projectByName.has(ck)) projectByName.set(ck, p.id)
    }
  }
  // For sub-project look-up: try sub-project name first, then parent name, then null.
  function resolveProjectId(subName: string, parentName: string): string | null {
    if (subName && projectByName.has(subName.toLowerCase())) return projectByName.get(subName.toLowerCase())!
    if (parentName && projectByName.has(parentName.toLowerCase())) return projectByName.get(parentName.toLowerCase())!
    return null
  }

  // 1. Disciplines
  for (const [code, line] of extract.disciplines) {
    if (discByCode.has(code.toLowerCase())) continue
    const { data, error } = await supabase.from('est_disciplines')
      .insert({ code, name: line.name }).select('id').single()
    if (error) { errors.push(`Discipline ${code}: ${error.message}`); continue }
    discByCode.set(code.toLowerCase(), data.id)
    stats.disciplines++
  }

  // 2. Categories
  for (const [, c] of extract.categories) {
    const discId = discByCode.get(c.discCode.toLowerCase())
    if (!discId) { errors.push(`Category ${c.code}: discipline ${c.discCode} not found`); continue }
    const key = `${discId}|${c.code.toLowerCase()}`
    if (catByKey.has(key)) continue
    const { data, error } = await supabase.from('est_categories')
      .insert({ discipline_id: discId, code: c.code, name: c.name }).select('id').single()
    if (error) { errors.push(`Category ${c.code}: ${error.message}`); continue }
    catByKey.set(key, data.id)
    stats.categories++
  }

  // 3. Sub-categories
  for (const [, s] of extract.subcategories) {
    const [discCode, catCode] = s.categoryKey.split('|')
    const discId = discByCode.get(discCode.toLowerCase())
    if (!discId) continue
    const catId = catByKey.get(`${discId}|${catCode.toLowerCase()}`)
    if (!catId) continue
    const subKey = `${catId}|${s.name.toLowerCase()}`
    if (subByKey.has(subKey)) continue
    const { data, error } = await supabase.from('est_subcategories')
      .insert({ category_id: catId, name: s.name, short_name: shortenName(s.name), uom: s.uom || 'Nos' })
      .select('id').single()
    if (error) { errors.push(`Sub-cat ${s.name}: ${error.message}`); continue }
    subByKey.set(subKey, data.id)
    stats.subcategories++
  }

  // 4. Resolve / create vendors and contractors as we walk the rates
  async function resolveParty(name: string): Promise<{ type: 'vendor' | 'contractor'; id: string } | null> {
    const key = name.toLowerCase()
    if (vendorByName.has(key))     return { type: 'vendor',     id: vendorByName.get(key)! }
    if (contractorByName.has(key)) return { type: 'contractor', id: contractorByName.get(key)! }
    const wantsContractor = classifyAsContractor(name)
    if (wantsContractor) {
      const { data, error } = await supabase.from('jmr_contractors')
        .insert({ name, status: 'active' }).select('id').single()
      if (error) { errors.push(`Create contractor "${name}": ${error.message}`); return null }
      contractorByName.set(key, data.id)
      return { type: 'contractor', id: data.id }
    } else {
      const { data, error } = await supabase.from('vendors')
        .insert({ name }).select('id').single()
      if (error) { errors.push(`Create vendor "${name}": ${error.message}`); return null }
      vendorByName.set(key, data.id)
      return { type: 'vendor', id: data.id }
    }
  }

  // 5. Rates
  for (const r of extract.rates) {
    const discId = discByCode.get(r.discCode.toLowerCase())
    if (!discId) continue
    const catId = catByKey.get(`${discId}|${r.catCode.toLowerCase()}`)
    if (!catId) continue
    const subId = subByKey.get(`${catId}|${r.subName.toLowerCase()}`)
    if (!subId) continue
    const party = await resolveParty(r.contractor)
    if (!party) continue
    const payload = {
      subcategory_id: subId,
      source_type:    party.type,
      vendor_id:      party.type === 'vendor'     ? party.id : null,
      contractor_id:  party.type === 'contractor' ? party.id : null,
      rate_per_unit:  r.rate,
      valid_from:     r.validFrom || null,
      valid_till:     r.validTill || null,
      project_id:     resolveProjectId(r.subProjectName, r.projectName),
      source_ref:     r.wo,
      source:         'in4-abstract',
      remarks:        r.subProjectName ? `Sub-project: ${r.subProjectName}` : null,
      created_by:     profile.id,
    }
    const { error } = await supabase.from('est_rates').insert(payload)
    if (error) {
      // Unique index handles re-imports — duplicate-key is fine to silently skip
      if (!error.message.includes('duplicate') && !error.message.includes('unique')) {
        errors.push(`Rate ${r.wo}/${r.subName}: ${error.message}`)
      } else {
        stats.skipped++
      }
      continue
    }
    stats.rates++
  }

  // 6. WO history — one row per WO seen
  const seenWos = new Set<string>()
  for (const w of extract.woHistory) {
    if (seenWos.has(w.wo)) continue
    seenWos.add(w.wo)
    const party = await resolveParty(w.contractor)
    const discId = discByCode.get(w.discCode.toLowerCase()) ?? null
    const catId = discId ? (catByKey.get(`${discId}|${w.catCode.toLowerCase()}`) ?? null) : null
    const payload = {
      wo_number:             w.wo,
      project_id:            resolveProjectId(w.subProjectName, w.projectName),
      contractor_name:       w.contractor,
      vendor_id:             party?.type === 'vendor'     ? party.id : null,
      contractor_id:         party?.type === 'contractor' ? party.id : null,
      work_description:      w.workDescription || null,
      in4_work_category:     w.inDiscRaw,
      in4_work_sub_category: w.inCatRaw,
      discipline_id:         discId,
      category_id:           catId,
      from_date:             w.validFrom || null,
      to_date:               w.validTill || null,
      base_value:            w.baseValue || null,
      source_file_name:      file.name,
      imported_by:           profile.id,
      remarks:               w.subProjectName ? `Sub-project: ${w.subProjectName}` : null,
    }
    const { error } = await supabase.from('est_wo_history')
      .upsert(payload, { onConflict: 'wo_number' })
    if (error) {
      errors.push(`WO ${w.wo}: ${error.message}`)
      continue
    }
    stats.wo_history++
  }

  // 7. Upload log
  await supabase.from('est_upload_log').insert({
    uploaded_by:   profile.id,
    source:        'in4-abstract',
    file_name:     file.name,
    rows_total:    stats.rows_total,
    rows_inserted: stats.rates + stats.wo_history,
    rows_skipped:  stats.skipped,
    error_log:     errors.length > 0 ? { errors: errors.slice(0, 100) } : null,
  })

  return {
    ok: true,
    message: `Imported ${stats.rates} rates · ${stats.wo_history} WO rows · ${stats.disciplines}/${stats.categories}/${stats.subcategories} new taxonomy${errors.length > 0 ? ` · ${errors.length} warnings` : ''}.`,
    stats,
  }
}

// ─── IN4 WO Detail Report ────────────────────────────────────
export async function importIn4WoDetail(formData: FormData): Promise<ImportResult> {
  const file = formData.get('file') as File | null
  if (!file) return { ok: false, message: 'No file', stats: emptyStats() }

  const { supabase, profile } = await getProfile()

  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(ws, { header: 1, raw: false })

  const errors: string[] = []
  const stats = { ...emptyStats() }
  stats.rows_total = rows.length

  const [vendorRes, contractorRes, subRes, projectsRes] = await Promise.all([
    supabase.from('vendors').select('id, name'),
    supabase.from('jmr_contractors').select('id, name'),
    supabase.from('est_subcategories').select('id, name'),
    supabase.from('projects').select('id, code, name, parent_project_id'),
  ])
  const vendorByName = new Map((vendorRes.data ?? []).map(v => [v.name.toLowerCase(), v.id]))
  const contractorByName = new Map((contractorRes.data ?? []).map(c => [c.name.toLowerCase(), c.id]))
  const subByName = new Map((subRes.data ?? []).map(s => [s.name.toLowerCase(), s.id]))

  const projectsAll = projectsRes.data ?? []
  const projectByName = new Map<string, string>()
  for (const p of projectsAll) {
    if (p.parent_project_id) projectByName.set(p.name.toLowerCase(), p.id)
  }
  for (const p of projectsAll) {
    const k = p.name.toLowerCase()
    if (!projectByName.has(k)) projectByName.set(k, p.id)
    if (p.code) {
      const ck = p.code.toLowerCase()
      if (!projectByName.has(ck)) projectByName.set(ck, p.id)
    }
  }
  function resolveProjectId(subName: string, parentName: string): string | null {
    if (subName && projectByName.has(subName.toLowerCase())) return projectByName.get(subName.toLowerCase())!
    if (parentName && projectByName.has(parentName.toLowerCase())) return projectByName.get(parentName.toLowerCase())!
    return null
  }

  for (const r of rows) {
    const row = extractWoDetailRow(r)
    if (!row) continue
    // Resolve party
    const key = row.contractor_name.toLowerCase()
    let vendorId: string | null = vendorByName.get(key) ?? null
    let contractorId: string | null = contractorByName.get(key) ?? null
    if (!vendorId && !contractorId) {
      if (classifyAsContractor(row.contractor_name)) {
        const { data } = await supabase.from('jmr_contractors')
          .insert({ name: row.contractor_name, status: 'active' }).select('id').single()
        if (data) { contractorId = data.id; contractorByName.set(key, data.id) }
      } else {
        const { data } = await supabase.from('vendors')
          .insert({ name: row.contractor_name }).select('id').single()
        if (data) { vendorId = data.id; vendorByName.set(key, data.id) }
      }
    }
    const subId = subByName.get(row.work_description.toLowerCase()) ?? null

    const payload = {
      wo_number:             row.wo_number,
      project_id:            resolveProjectId(row.sub_project_name, row.project_name),
      contractor_name:       row.contractor_name,
      vendor_id:             vendorId,
      contractor_id:         contractorId,
      work_description:      row.work_description || null,
      in4_work_category:     row.in4_work_category,
      in4_work_sub_category: row.in4_work_sub_category,
      subcategory_id:        subId,
      from_date:             row.from_date || null,
      to_date:               row.to_date || null,
      status:                row.status || null,
      base_value:            row.base_value || null,
      total_tax:             row.total_tax || null,
      total_value:           row.total_value || null,
      scope_of_work:         row.scope_of_work || null,
      remarks:               row.remarks || null,
      source_file_name:      file.name,
      imported_by:           profile.id,
    }
    const { error } = await supabase.from('est_wo_history')
      .upsert(payload, { onConflict: 'wo_number' })
    if (error) {
      errors.push(`WO ${row.wo_number}: ${error.message}`)
      stats.skipped++
      continue
    }
    stats.wo_history++
  }

  await supabase.from('est_upload_log').insert({
    uploaded_by:   profile.id,
    source:        'in4-wo',
    file_name:     file.name,
    rows_total:    stats.rows_total,
    rows_inserted: stats.wo_history,
    rows_skipped:  stats.skipped,
    error_log:     errors.length > 0 ? { errors: errors.slice(0, 100) } : null,
  })

  return {
    ok: true,
    message: `Imported ${stats.wo_history} WO rows · ${stats.skipped} skipped${errors.length > 0 ? ` · ${errors.length} warnings` : ''}.`,
    stats,
  }
}

function emptyStats() {
  return {
    disciplines: 0, categories: 0, subcategories: 0,
    rates: 0, wo_history: 0, skipped: 0, rows_total: 0,
  }
}
