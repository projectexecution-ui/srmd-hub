'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Option = { id: string; name: string; code: string | null }

interface Props {
  projects: Option[]
  contractors: { id: string; name: string }[]
  subProjects: Option[]
  currentProjectId: string
  currentContractorId: string
  currentCategory: 'equipment' | 'manpower' | 'both'
  currentDateFrom: string
  currentDateTo: string
  currentSubProjectIds: string[]
}

export function MatrixFilters(p: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [project, setProject] = useState(p.currentProjectId)
  const [contractor, setContractor] = useState(p.currentContractorId)
  const [category, setCategory] = useState(p.currentCategory)
  const [from, setFrom] = useState(p.currentDateFrom)
  const [to, setTo] = useState(p.currentDateTo)
  const [subSet, setSubSet] = useState(() => new Set(p.currentSubProjectIds))

  function apply() {
    const u = new URLSearchParams()
    if (project) u.set('project', project)
    if (contractor) u.set('contractor', contractor)
    if (category !== 'both') u.set('cat', category)
    if (from) u.set('from', from)
    if (to) u.set('to', to)
    for (const id of subSet) u.append('sp', id)
    router.push(`/jmr/matrix?${u.toString()}`)
  }

  function toggleSub(id: string) {
    const next = new Set(subSet)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSubSet(next)
  }

  return (
    <Card className="p-3 mb-2">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div>
          <Label className="text-xs">Project</Label>
          <select value={project} onChange={e => { setProject(e.target.value); setSubSet(new Set()) }} className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
            {p.projects.map(x => <option key={x.id} value={x.id}>{x.code || x.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Contractor</Label>
          <select value={contractor} onChange={e => setContractor(e.target.value)} className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
            <option value="">All contractors</option>
            {p.contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Category</Label>
          <select value={category} onChange={e => setCategory(e.target.value as 'equipment' | 'manpower' | 'both')} className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
            <option value="both">Both</option>
            <option value="equipment">Equipment</option>
            <option value="manpower">Manpower</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">From (optional)</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Cumulative till</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 h-9 text-sm" />
        </div>
      </div>
      {p.subProjects.length > 0 && (
        <div className="mt-3">
          <Label className="text-xs">Sub-projects {subSet.size > 0 ? `(${subSet.size} selected)` : '(all)'}</Label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {p.subProjects.map(sp => {
              const on = subSet.has(sp.id)
              return (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => toggleSub(sp.id)}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                  {sp.code || sp.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="mt-3">
        <Button size="sm" onClick={apply}>Apply filters</Button>
      </div>
    </Card>
  )
}
