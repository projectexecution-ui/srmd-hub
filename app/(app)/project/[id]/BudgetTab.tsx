import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { loadCategoryWise, loadCtWise } from '@/lib/revamp/budget-actual-data'
import type { CategoryLine, Kpi, MoneyRow, SubSkillLine } from '@/lib/revamp/budget-actual'

/**
 * Budget vs Actual (build order §2) — three views behind the sub-tab pills.
 *
 *   0  Category / sub-category wise   CT Hub's Internal Estimate, to the rupee
 *   1  Category — WO/PO wise          the orders tree
 *   2  CT wise                        sub-project roll-up, flat
 *
 * §10 throughout: a money cell shows what CT Hub or IN4 holds, or an em-dash.
 * Nothing is back-calculated, and no zero stands in for a missing figure.
 */
export async function BudgetTab({ projectId, view }: { projectId: string; view: number }) {
  if (view === 2) return <CtWiseView projectId={projectId} />
  if (view === 1) return <OrdersPlaceholder />
  return <CategoryWiseView projectId={projectId} />
}

/* ── shared money cell ──────────────────────────────────────────────────── */

const Dash = () => <span className="text-gray-300">—</span>

function Money({ v, perSft, bold }: { v: number | null; perSft: number | null; bold?: boolean }) {
  if (v == null) return <Dash />
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={cn('tabular-nums', bold && 'font-semibold')}>{formatINR(Math.round(v))}</span>
      {perSft != null && (
        <span className="text-[10.5px] text-gray-400 tabular-nums">₹{perSft.toLocaleString('en-IN')}/sft</span>
      )}
    </span>
  )
}

const per = (v: number | null, area: number | null) =>
  v == null || !area || area <= 0 ? null : Math.round(v / area)

function Pct({ v }: { v: number | null }) {
  if (v == null) return <Dash />
  return <span className="tabular-nums font-medium">{v}%</span>
}

/* ── pill 1 — category / sub-category wise ──────────────────────────────── */

async function CategoryWiseView({ projectId }: { projectId: string }) {
  const { table, kpis, areaSft, error } = await loadCategoryWise(projectId)

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-semibold text-rose-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> The budget could not be read
        </p>
        <p className="text-xs text-rose-800 mt-1 font-mono break-all">{error}</p>
      </div>
    )
  }

  const shown = table.categories.filter(c => !c.isEmpty)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {kpis.map(k => <KpiCard key={k.label} kpi={k} />)}
      </div>

      {/* Desktop table. Its own scroll container with max-h, so the header can
          be sticky — AGENTS.md: page-level sticky is inert under `main`. */}
      <div className="hidden xl:block rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-gray-100 text-[12.5px] text-gray-500">
          <span>Work categories — totals roll up from the sub-categories.</span>
          {table.emptyCount > 0 && (
            <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
              {table.emptyCount} empty hidden
            </span>
          )}
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur">
              <tr className="text-[10.5px] uppercase tracking-[0.04em] text-gray-500">
                <Th className="text-left pl-4">Work category / sub-skill</Th>
                <Th>Internal estimate</Th>
                <Th>Awaiting approval</Th>
                <Th>Budget (ERP)</Th>
                <Th>WO / PO</Th>
                <Th>Paid</Th>
                <Th>% used<span className="block text-[9.5px] normal-case tracking-normal text-gray-400 font-normal">Paid ÷ Budget (ERP)</span></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map(cat => <CategoryRows key={cat.disciplineId} cat={cat} areaSft={areaSft} />)}
              <TotalRow totals={table.totals} areaSft={areaSft} />
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile — the same figures as cards. Every screen ships phone and
          desktop in the same change (§10). */}
      <div className="xl:hidden space-y-2">
        {table.emptyCount > 0 && (
          <p className="text-[11px] text-gray-400">{table.emptyCount} empty categories hidden.</p>
        )}
        {shown.map(cat => (
          <details key={cat.disciplineId} className="rounded-xl border border-gray-200 bg-white">
            <summary className="list-none cursor-pointer px-3 py-3 min-h-[44px] flex items-start gap-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900">
                  {cat.code && <span className="text-gray-400 tabular-nums mr-1.5">{cat.code}</span>}
                  {cat.name}
                </span>
                <span className="block text-[11px] text-gray-400 mt-0.5">
                  {cat.sheetCount > 0 ? `${cat.sheetCount} sheet${cat.sheetCount === 1 ? '' : 's'}` : 'no sheets'}
                </span>
              </span>
              <span className="text-right text-sm">
                <Money v={cat.internalEstimate} perSft={per(cat.internalEstimate, areaSft)} />
              </span>
            </summary>
            <dl className="border-t border-gray-100 px-3 py-2 grid grid-cols-2 gap-y-1.5 text-[12.5px]">
              <Field label="Awaiting"><Money v={cat.awaitingApproval} perSft={null} /></Field>
              <Field label="Budget (ERP)"><Money v={cat.budgetErp} perSft={null} /></Field>
              <Field label="WO / PO"><Money v={cat.woPo} perSft={null} /></Field>
              <Field label="Paid"><Money v={cat.paid} perSft={null} /></Field>
              <Field label="% used"><Pct v={cat.pctUsed} /></Field>
            </dl>
            {cat.subSkills.filter(s => !isEmptySub(s)).length > 0 && (
              <ul className="border-t border-gray-100 divide-y divide-gray-50">
                {cat.subSkills.filter(s => !isEmptySub(s)).map(s => (
                  <li key={s.subSkillId} className="px-3 py-2 flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[12.5px] text-gray-600">
                      {s.code && <span className="text-gray-400 tabular-nums mr-1.5">{s.code}</span>}
                      {s.name}
                    </span>
                    <span className="text-[12.5px] text-right">
                      <Money v={s.internalEstimate} perSft={null} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
        <div className="rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">Total</span>
          <Money v={table.totals.internalEstimate} perSft={per(table.totals.internalEstimate, areaSft)} bold />
        </div>
      </div>

      <p className="text-[11.5px] text-gray-400 leading-relaxed">
        Internal estimate is the maintained figure where one is set, otherwise the latest
        working sheet for that sub-category. Where a category carries its own budget line, the
        sheets beneath it are not added on top — that would count the same money twice.
        {areaSft == null && ' This project has no area set, so ₹/sft cannot be shown.'}
      </p>
    </div>
  )
}

const isEmptySub = (s: SubSkillLine) =>
  s.internalEstimate == null && s.budgetErp == null && s.woPo == null && s.paid == null

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right text-gray-900">{children}</dd>
    </>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2 text-right font-semibold align-bottom', className)}>{children}</th>
}

function CategoryRows({ cat, areaSft }: { cat: CategoryLine; areaSft: number | null }) {
  const subs = cat.subSkills.filter(s => !isEmptySub(s))
  return (
    <>
      <tr className="hover:bg-gray-50/60">
        <td className="pl-4 pr-3 py-2.5">
          <span className="font-medium text-gray-900">
            {cat.code && <span className="text-gray-400 tabular-nums mr-1.5 text-[11.5px]">{cat.code}</span>}
            {cat.name}
          </span>
          {cat.sheetCount > 0 && (
            <span className="ml-2 text-[11px] text-gray-400">
              {cat.sheetCount} sheet{cat.sheetCount === 1 ? '' : 's'}
            </span>
          )}
        </td>
        <Td><Money v={cat.internalEstimate} perSft={per(cat.internalEstimate, areaSft)} /></Td>
        <Td><Money v={cat.awaitingApproval} perSft={null} /></Td>
        <Td><Money v={cat.budgetErp} perSft={per(cat.budgetErp, areaSft)} /></Td>
        <Td><Money v={cat.woPo} perSft={per(cat.woPo, areaSft)} /></Td>
        <Td><Money v={cat.paid} perSft={per(cat.paid, areaSft)} /></Td>
        <Td><Pct v={cat.pctUsed} /></Td>
      </tr>
      {subs.map(s => (
        <tr key={s.subSkillId} className="bg-gray-50/40 text-[12.5px]">
          <td className="pl-10 pr-3 py-2 text-gray-600">
            {s.code && <span className="text-gray-400 tabular-nums mr-1.5 text-[11px]">{s.code}</span>}
            {s.name}
            {s.estimateFromSheet && (
              <span
                title="No maintained estimate on this sub-category — the figure is its latest working sheet"
                className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
              >
                from sheet
              </span>
            )}
          </td>
          <Td><Money v={s.internalEstimate} perSft={null} /></Td>
          <Td><Money v={s.awaitingApproval} perSft={null} /></Td>
          <Td><Money v={s.budgetErp} perSft={null} /></Td>
          <Td><Money v={s.woPo} perSft={null} /></Td>
          <Td><Money v={s.paid} perSft={null} /></Td>
          <Td><Pct v={s.pctUsed} /></Td>
        </tr>
      ))}
    </>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-right whitespace-nowrap">{children}</td>
}

function TotalRow({ totals, areaSft }: { totals: MoneyRow; areaSft: number | null }) {
  return (
    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
      <td className="pl-4 pr-3 py-3 text-gray-900">Total</td>
      <Td><Money v={totals.internalEstimate} perSft={per(totals.internalEstimate, areaSft)} bold /></Td>
      <Td><Money v={totals.awaitingApproval} perSft={null} bold /></Td>
      <Td><Money v={totals.budgetErp} perSft={per(totals.budgetErp, areaSft)} bold /></Td>
      <Td><Money v={totals.woPo} perSft={per(totals.woPo, areaSft)} bold /></Td>
      <Td><Money v={totals.paid} perSft={per(totals.paid, areaSft)} bold /></Td>
      <Td><Pct v={totals.pctUsed} /></Td>
    </tr>
  )
}

const TONES: Record<Kpi['tone'], string> = {
  ie: 'border-t-indigo-600',
  awaiting: 'border-t-yellow-500',
  budget: 'border-t-blue-600',
  wo: 'border-t-purple-600',
  paid: 'border-t-orange-500',
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <div className={cn('rounded-xl border border-gray-200 border-t-[3px] bg-white p-3.5', TONES[kpi.tone])}>
      <p className="text-[10.5px] tracking-[0.05em] text-gray-500">{kpi.label}</p>
      <p className="text-[22px] font-semibold text-gray-900 leading-tight mt-1 tabular-nums">
        {kpi.amount == null ? <Dash /> : formatINR(Math.round(kpi.amount))}
      </p>
      {kpi.perSft != null && (
        <p className="text-xs text-gray-500 tabular-nums mt-0.5">₹{kpi.perSft.toLocaleString('en-IN')}/sft</p>
      )}
      <p className="text-xs text-gray-500 mt-1.5">{kpi.context}</p>
    </div>
  )
}

/* ── pill 3 — CT wise ───────────────────────────────────────────────────── */

async function CtWiseView({ projectId }: { projectId: string }) {
  const { rows, total, error, note } = await loadCtWise(projectId)

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-semibold text-rose-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> The sub-project roll-up could not be read
        </p>
        <p className="text-xs text-rose-800 mt-1 font-mono break-all">{error}</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Not linked to an IN4 sub-project yet</p>
        <p className="text-xs text-amber-800 mt-1">
          This roll-up reads IN4 sub-projects, and the link is a confirmed mapping rather than a
          name match. Confirm it on{' '}
          <Link href="/admin/masters/mapping" className="underline font-medium">Masters → Mapping</Link>{' '}
          and the rows appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur">
              <tr className="text-[10.5px] uppercase tracking-[0.04em] text-gray-500">
                <Th className="text-left pl-4">Sub-project</Th>
                <Th>Area (sft)</Th>
                <Th>Budget (ERP)</Th>
                <Th>WO / PO approved</Th>
                <Th>Uncommitted</Th>
                <Th>Certified</Th>
                <Th>% used</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.subprojectId} className="hover:bg-gray-50/60">
                  <td className="pl-4 pr-3 py-2.5 text-gray-900">{r.name}</td>
                  <Td>{r.areaSft == null ? <Dash /> : <span className="tabular-nums">{r.areaSft.toLocaleString('en-IN')}</span>}</Td>
                  <Td><Money v={r.budgetErp} perSft={null} /></Td>
                  <Td><Money v={r.woApproved} perSft={null} /></Td>
                  <Td><Money v={r.uncommitted} perSft={null} /></Td>
                  <Td><Money v={r.certified} perSft={null} /></Td>
                  <Td><Pct v={r.pctUsed} /></Td>
                </tr>
              ))}
              {total && (
                <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                  <td className="pl-4 pr-3 py-3">Total</td>
                  <Td>{total.areaSft == null ? <Dash /> : <span className="tabular-nums">{total.areaSft.toLocaleString('en-IN')}</span>}</Td>
                  <Td><Money v={total.budgetErp} perSft={null} bold /></Td>
                  <Td><Money v={total.woApproved} perSft={null} bold /></Td>
                  <Td><Money v={total.uncommitted} perSft={null} bold /></Td>
                  <Td><Money v={total.certified} perSft={null} bold /></Td>
                  <Td><Pct v={total.pctUsed} /></Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11.5px] text-gray-400 leading-relaxed">{note}</p>
    </div>
  )
}

/* ── pill 2 — the orders tree ───────────────────────────────────────────── */

function OrdersPlaceholder() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm font-semibold text-gray-900">Category — WO/PO wise</p>
      <p className="text-[13px] text-gray-600 mt-1.5 max-w-2xl leading-relaxed">
        The orders tree — category → sub-category → order → BOQ item → bill, work orders and POs
        together. It reads the same IN4 tables as Procurement → WO / PO (§3), so it is built
        alongside that tab rather than twice, and lands in the next stage.
      </p>
      <p className="text-[11.5px] text-gray-400 mt-3">
        Nothing is hidden behind this: the same money is on the Category / sub-category view now,
        cut by budget category instead of by order.
      </p>
    </div>
  )
}
