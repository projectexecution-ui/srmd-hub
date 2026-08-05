# SRMD Construction — Team Problems → Systems

A living backlog of the real problems we hit, so we can **sit, prioritise, and build ONE system per problem for the whole team** (not per-person workarounds). Aksha dictates; each item is captured here, then turned into a solution in CT HUB.

**Flow:** capture → prioritise → design the system → build → roll out to the team.

> **Guiding direction (Aksha, 2026-08-05): build ONE central tracker, not many separate ones.**
> A single per-project **cockpit** where everything shows as lanes/tabs — schedule, the Dwg → Budget → WO pipeline, daily site entries, procurement, bills — instead of a separate app per feature. One place the team follows. Solve the problems below as parts of this one tracker.

**Priority:** 🔴 urgent/painful · 🟡 medium · 🟢 later
**Status:** `new` → `discussing` → `building` → `done`

---

| # | Problem (in your words) | Who it hurts | Pain today | First idea for a system | Priority | Status |
|---|-------------------------|--------------|------------|-------------------------|----------|--------|
| 1 | Engineers not filling daily site material entries on time (Daily Site Report) | Atm Heads & management (no live view of site deliveries); delays the bill → GRN → payment chain | Have to chase each engineer by hand; the daily report ends up incomplete / unreliable | Daily reminder to each engineer for their own site by a cut-off time → auto-escalate to the Atm Head if still not filled → a "who hasn't filled today" board for heads; make entry 1-tap on mobile | 🔴 | new |
| 2 | Work Orders not issued on time — blocked by the chain **Drawings → Budget → Work Order** (each depends on the previous) | Sites/contractors (work can't start), project schedule, management | No single view of where each project is stuck in the Dwg → Budget → WO chain; delays cascade and it's unclear what's blocking which WO or who owns the next step | Per-project **pipeline tracker** for Dwg → Budget → WO with aging/SLA at each stage, "blocked-by" + owner of the next step, and nudges when a stage stalls (ties into Cost Control budgets that already exist) | 🔴 | new |
| 3 | No **simple, single schedule tracker** for sites — tried MSP & Zoho Projects, not happy (too heavy / low adoption). Want ONE simple tracker, with **Work Orders incorporated** into the schedule | PMs, site engineers, management — tracking plan vs actual across projects | Schedule and Work Orders live in different tools; MSP/Zoho too complex so nobody keeps them updated; no single "where is this project vs plan" view | Lightweight in-app **schedule tracker** per project: phases/tasks with planned-vs-actual dates, % done, simple timeline/Gantt; **link each Work Order to a task/milestone** so the schedule and WOs are one thing; dead-simple update flow the team will actually use (ties to #2) | 🟡 | new |
| 4 | **AI daily site-photo Quality check** — engineers upload daily site pics; AI reviews them, highlights good (green) / issues (red), and generates a daily quality report to improve construction quality | Quality control, engineers, management | No systematic daily photo review; quality issues spotted late or missed; QA is manual & inconsistent | Photo upload lane in the site cockpit → Claude **vision** analyses each day's pics → red/green flags with a **1-line reason + best recommended fix** → auto **daily quality report** per site (short & simple) → quality trend over time. Needs Anthropic **API (vision)** access | 🟡 | new |
| 5 | Engineers have **no on-demand expert help** for construction/site questions → can't self-learn or resolve quickly | Site engineers (stuck), quality & speed | Rely on calling seniors; slow, inconsistent knowledge across the team | In-app **"Ask AI"** for construction/site queries (Claude), so engineers get instant guidance and learn on the job. Delivered via API-backed in-app chat (or Claude seats) — see plan note below | 🟢 | new |

---

## Plan note — what the AI items (#4, #5) actually need

There are **two different Claude things**, and it's easy to mix them up:

- **The Claude chat app / plan** (claude.ai Free / Pro / Team, or Claude Code) — that's a **person** sitting and chatting with Claude. Per-seat monthly price.
- **A Claude API key** (from the Anthropic Console) — that's the **CT HUB app itself** calling Claude in the background. **Pay only for what you use** (per photo, per question). No seats.

**Both #4 (photo QA) and #5 (Ask AI for engineers) need the API key, NOT a bigger chat plan.** Reason: the AI lives *inside* CT HUB — engineers upload a photo or type a question in the tracker, the app calls Claude and shows the answer. One login, controlled, logged, and we can lock the "Ask AI" to construction topics only.

**Rough cost at our scale** (pay-per-use, no seats):
- Photo QA: **~½–1 paisa-equivalent… ~₹1 per photo**. At ~150 photos/day ≈ **₹3–5k/month**.
- Ask AI chat: a few paise per question. At ~100 questions/day ≈ **₹4–5k/month**.
- So the whole thing is roughly **₹8–12k/month, and only if it's actually used** — quiet days cost almost nothing. (vs. buying every engineer their own Claude Team seat ≈ ₹2k+/person/month → ₹30k+/month for the team, whether they use it or not.)

**Recommendation:** get **Anthropic API access** (one key, added in the Anthropic Console with a card + credits) — that covers both features. Don't buy per-engineer chat seats. Aksha adds the card/credits (I can't enter payment); I wire the key into CT HUB as a secret and build the two lanes when you say go.

---

_Add items above as Aksha gives them. Once the list is full, we rank the top 3–5 and build them one at a time. Can also be turned into a shareable board for the team._
