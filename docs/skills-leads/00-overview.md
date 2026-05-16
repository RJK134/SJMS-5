# SJMS-5 Skills-Lead Briefs — Overview

> **Purpose:** thirteen pre-distilled subagent briefs (this overview + 12 phase-aligned leads). Each lead is a self-contained prompt suitable for invoking a `general-purpose` subagent via the `Agent` tool. Each is keyed to one phase of the [build queue](../SJMS-5-BUILD-QUEUE.md).
>
> **Why not the 54-role library directly:** the SJMS-2.5 skills library (`RJK134/SJMS-2.5/skills/`) carries 54 role personas across Student Finance (12), Curriculum Management (10), Curriculum Design (12), Student Journey (15), HERM (5), plus 3 additional skill packages (`hesa-data-management`, `sjms-compliance-expert`, `sjms-data-migration-lead`). Spawning 54 distinct agents would create coordination overhead and re-brief context cost on every spawn. Bundling the relevant 3–6 roles into **one lead per phase** is the right granularity.
>
> **Operating policy:** see [`SJMS-5-PLAN-AMENDMENTS-2026-05-16.md`](../SJMS-5-PLAN-AMENDMENTS-2026-05-16.md) §12.

---

## How a lead brief is used

1. **At phase opening:** the Claude session driving the phase reads the relevant lead brief and uses it as the system context for the design-doc agent (STOP-gated phases) or batch-breakdown agent (open phases).
2. **At phase closeout:** the same lead brief is used as the briefing for the compliance-review agent that audits the merged diff against the phase's acceptance criteria.
3. **Mid-phase parallel slices:** when two batches within a phase are independent, the lead brief is split into "primary" + "supporting" persona sections, with each subagent receiving the relevant slice.

## Brief structure

Every lead brief follows the same shape:

- **Persona** — the role being assumed, with reference to the primary `skills/` source.
- **Mission** — one paragraph stating the outcome the agent owns.
- **Primary skills source(s)** — file path(s) in `RJK134/SJMS-2.5/skills/` the agent may read for full role specs.
- **Supporting skills sources** — additional persona references for cross-cutting concerns.
- **Inputs** — what the agent receives at spawn time.
- **Outputs** — what the agent returns.
- **Non-goals** — explicit out-of-scope to prevent drift.
- **Verification** — how the parent session verifies the agent's output.
- **Phase scope** — the canonical batches the agent is responsible for.

## Lead catalogue

| # | Phase | Lead | Primary skill source |
|---|---|---|---|
| 1 | 0 | Spine Import Lead | `skills/herm/01-system-architect.md` + `skills/sjms-data-migration-lead/` |
| 2 | 1 | Finance Closeout Lead | `skills/student-finance/01-student-finance-product-owner.md` |
| 3 | 2 | Multi-Tenancy Architect | `skills/herm/01-system-architect.md` + `skills/curriculum-management/07-cms-domain-data-modeler.md` |
| 4 | 3 | HESA / UKVI / Regulatory Lead | `skills/hesa-data-management/SKILL.md` + `skills/sjms-compliance-expert/SKILL.md` |
| 5 | 4 | PGR Domain Lead | New persona (synthesised) |
| 6 | 5 | Apprenticeships Domain Lead | New persona (synthesised) |
| 7 | 6 | Recruitment & Enquiry CRM Lead | Derived from admissions roles + new persona |
| 8 | 7 | Accommodation / VLE / AI Assistive Lead | `skills/student-journey/06-tutorials-attendance-engagement-product-owner.md` + new AI persona |
| 9 | 8 | Integration Activation Lead | `skills/curriculum-management/08-integrations-publishing-engineer.md` + `skills/student-finance/08-erp-gl-integration-architect.md` |
| 10 | 9 | Portal Completion / Student Journey Lead | `skills/student-journey/01-e2e-student-journey-architect.md` |
| 11 | 10 | Analytics & BI Lead | `skills/curriculum-management/09-reporting-mi-designer.md` |
| 12 | 11 | AI-Native Architect | New persona (synthesised) |
| 13 | 12 | Pilot Readiness Lead | `skills/sjms-data-migration-lead/SKILL.md` + `skills/student-finance/12-pci-payment-security-lead.md` |

## Adding a new lead

If a phase scope expands beyond what one lead can cover, the lead is split into two co-leads. Each remains self-contained. The phase's BUILD-QUEUE entry is updated to point at both.

## Source library

Canonical skill personas are at **`RJK134/SJMS-2.5/skills/`** with the following subdirectories:

- `student-finance/` (12 roles)
- `curriculum-management/` (10 roles)
- `curriculum-design/` (12 roles)
- `student-journey/` (15 roles)
- `herm/` (5 roles, 165 capabilities)
- `reference/` (comparative analyses)
- `hesa-data-management/` (1 skill package)
- `sjms-compliance-expert/` (1 skill package)
- `sjms-data-migration-lead/` (1 skill package)

The library README at `RJK134/SJMS-2.5/skills/README.md` is the catalogue index.
