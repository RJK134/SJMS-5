# SJMS-5 — Claude Code Master Context

> **Owner:** Richard Knapp · Future Horizons Education (FHE)
> **Last updated:** 2026-05-01
> **Current delivery state:** Phase 15A merged (PR #55, commit `953ed77`). ESLint toolchain bootstrap (KI-P14-001 closeout) merged (PR #88, commit `67df18f`). Governance batch merged as PR #92 (commit `75e43c6`, 2026-04-22). Phase 16 — Admissions to Enrolment was delivered through Batches 16A–16E (16E merged as PR #161 on top of the secrets-at-rest scope cut PR #160). **Phase 17 — Assessment to Progression to Award is COMPLETE.** Batches 17A (PR #163, `ccbdc93`), 17B (PR #164, `6531b28`), 17C (PR #166, `017286e`), 17D (PR #167, `2b480ee`), 17E (PR #168, `7280d17`), and 17F (closeout — server coverage thresholds ratcheted from monitor-only `0/0/0/0` to `lines: 35`, `functions: 16`, `branches: 33`, `statements: 35` in `server/vitest.config.ts`; KI-P14-002 closed; PR #170) are all merged. **Phase 18 — Finance Readiness is IN FLIGHT. Batch 18A (fee calculation engine) is COMPLETE on `claude/phase-18a-fee-calculation` (PR #171, merged), Batch 18B (invoice and charge generation) is on `claude/phase-18b-invoice-generation` (PR #173, draft, all 15 CI checks passing).** Pure utility `utils/invoice-composition.ts::composeInvoiceFromAssessment` transforms a FeeAssessment outcome into a structured invoice body (single TUITION line for `finalFee`, 30-day default due window, GBP currency, deterministic invoice number `INV-{shortYear}-{acc8}-{fa8}`); new repo `invoice.repository.ts` (CRUD + `findByInvoiceNumber` + `createWithLines` atomic Invoice + ChargeLine + StudentAccount.balance/totalDebits update inside a single Prisma transaction); new helper `finance.repository.findByStudentAndYear`; new service `invoices.service.ts::generateForFeeAssessment` with deterministic-invoice-number idempotency and a force-replacement counter scheme. New endpoint `POST /v1/invoices/generate` plus standard CRUD, FINANCE-role gated. New webhook routes `invoice.created` / `invoice.updated` / `invoice.generated` / `invoice.status_changed` / `invoice.deleted`. **Batch 18C (payment allocation) is on `claude/phase-18c-payment-allocation` (PR pending; stacked on 18B):** pure utility `utils/payment-allocation.ts::allocatePayment` distributes a Payment across open ChargeLines with FIFO (default; due-date order) or PROPORTIONAL strategies; new repos `payment.repository.ts` (CRUD with soft-delete) and `chargeLine.repository.ts` (read-mostly + transaction-aware `markPaidBulk`); new transaction-aware repo helpers `invoice.repository.{incrementPaidAmountInTx,findStatusProjectionInTx,updateStatusInTx}` and `finance.repository.recordPaymentLedgerEntryInTx`; new service utility `utils/prisma-tx.ts::runInTransaction`; new service `payments.service.ts::allocateForPayment` orchestrates allocate + persist atomically (flips fully-covered ChargeLines to PAID, increments Invoice.paidAmount per affected invoice, promotes invoice statuses to PAID/PARTIALLY_PAID, decrements StudentAccount.balance and increments totalCredits by the full payment amount). New endpoint `POST /v1/payments/:id/allocate` plus standard CRUD, FINANCE-role gated. New webhook routes `payment.created` / `payment.updated` / `payment.allocated` / `payment.status_changed` / `payment.deleted`. `expectedRouters` bumped 46 → 47. Server Vitest 504/504 passing (was 464/464 post-18B; +21 pure-function + 19 service-orchestration cases). Server tsc, client tsc, Prisma validate/generate, docs-truth, Gate 4 (no direct Prisma in services) all clean. Phase 15B (auth/MFA/identity-cache/retention) remains deferred behind a STOP-gate and a design doc.
> **Operating model:** `docs/delivery-plan/enterprise-delivery-operating-model.md` — canonical for every phase from 16 onward.

---

## Project position

SJMS 2.5 combines the polished SJMS 2.4 portal experience with the enterprise backend foundations built in SJMS 4.0. The platform baseline is now strong: 196 Prisma models, 45 API routers, 36 roles, 15 version-controlled n8n workflows, Redis-backed infrastructure, Keycloak OIDC, MinIO, and Prometheus metrics.

The remaining gap is **enterprise readiness through business-rule depth and operational discipline**, not broad CRUD expansion.

## Delivery control set

Read these before every phase:

- `/home/runner/work/SJMS-2.5/SJMS-2.5/CLAUDE.md`
- `/home/runner/work/SJMS-2.5/SJMS-2.5/.claude/CLAUDE.md`
- `/home/runner/work/SJMS-2.5/SJMS-2.5/docs/BUILD-QUEUE.md`
- `/home/runner/work/SJMS-2.5/SJMS-2.5/docs/VERIFICATION-PROTOCOL.md`
- `/home/runner/work/SJMS-2.5/SJMS-2.5/docs/KNOWN_ISSUES.md`
- `/home/runner/work/SJMS-2.5/SJMS-2.5/docs/delivery-plan/enterprise-readiness-plan.md`
- `/home/runner/work/SJMS-2.5/SJMS-2.5/docs/delivery-plan/enterprise-delivery-operating-model.md` — canonical operating model for Phases 16–23
- relevant review/remediation docs under `/home/runner/work/SJMS-2.5/SJMS-2.5/docs/review/` and `/home/runner/work/SJMS-2.5/SJMS-2.5/docs/remediation/`

## Non-negotiable delivery rules

1. British English throughout.
2. Prisma-backed persistence only — no MemStorage or in-memory business stores.
3. Audit every mutation.
4. Emit a canonical webhook event for every mutation.
5. Use one active phase branch at a time from `main`.
6. Use `report_progress` before the first edit and after each meaningful batch.
7. Run the verification protocol after each batch.
8. Request BugBot review on every phase PR and fix HIGH findings before merge.
9. Update the control set before declaring a phase complete.
10. Do not expand horizontally into new domains until the core vertical journeys are rule-complete.

## Current roadmap

| Phase | Branch | Focus |
|---|---|---|
| 14 | `phase-14/governance-baseline` | Governance, truth baseline, release discipline |
| 15 | `phase-15/security-hardening` | Security and platform blockers |
| 16 | `phase-16/admissions-to-enrolment` | Admissions to enrolment golden journey |
| 17 | `phase-17/assessment-to-award` | Assessment to progression/award golden journey |
| 18 | `phase-18/finance-readiness` | Fees, invoicing, payments, finance controls |
| 19 | `phase-19/statutory-compliance` | HESA, UKVI, EC/appeals compliance execution |
| 20 | `phase-20/integration-activation` | n8n activation and external connectors |
| 21 | `phase-21/portal-completion` | Portal completion, scoping, accessibility |
| 22 | `phase-22/analytics-operability` | Analytics, BI, observability |
| 23 | `phase-23/pilot-readiness` | Pilot readiness and controlled deployment |

## Immediate open items already sequenced

- MFA enforcement → Phase 15B (STOP-gated)
- Redis-backed identity cache → Phase 15B (STOP-gated)
- ESLint toolchain bootstrap → MERGED (PR #88, commit `67df18f`); KI-P14-001 closed
- ESLint baseline triage and ratchet to blocking → KI-P15-002 (Phase 15B or dedicated `fix/eslint-baseline` branch)
- Server coverage threshold ratchet → CLOSED 2026-05-01 — Phase 17F (`server/vitest.config.ts` enforces `35/16/33/35`; KI-P14-002)
- npm audit baseline triage → Phase 15B or dedicated `fix/` branch (KI-P15-001)
- KI-P12-001 — enrolment cascade repository bypass → CLOSED 2026-04-24 (Batch 16D — repository helpers `findActiveByEnrolment` / `cascadeStatusForEnrolment`)
- Finance sub-domains (Sponsors, Bursaries, Refunds) → Phase 18
- n8n workflow activation → Phase 20
- MinIO presigned uploads → Phase 21
- Teaching-assignment model → Phase 21
- Multi-tenancy substrate → after Phase 23 unless pulled forward by commercial need

## Reference status

- Server typecheck: passing
- Client typecheck: passing
- Prisma validate/generate: passing
- Server Vitest suite: passing
- Coverage enforcement: `lines: 35`, `functions: 16`, `branches: 33`, `statements: 35` in `server/vitest.config.ts` (Phase 17F; KI-P14-002 closed)
- Linting: ESLint v9 flat config live in both workspaces (PR #88 merged); `Lint (advisory)` CI job runs with `continue-on-error: true`; baseline triage and ratchet-to-blocking tracked as KI-P15-002 (Gate 12 in `docs/VERIFICATION-PROTOCOL.md`)
- Repository hygiene: no gitlinks, no tracked `.claude/worktrees/`, no stray `.claude/*.txt` (Gate 9 in `docs/VERIFICATION-PROTOCOL.md`)
- Security observability: CodeQL, npm audit, Dependabot, SECURITY.md, CODEOWNERS all present (Gate 11); npm audit baseline not yet triaged (KI-P15-001)

## Strategic rule

SJMS 2.5 should aim for **HERM-aligned completeness in a single-institution UK HE deployment**, not literal feature-for-feature parity with SITS, Banner, or Workday. The winning path is vertical completion of golden journeys, not more surface area.
