# Phase 1B — Sponsors and Sponsor Invoices

> **Branch:** `phase-1b/sponsors-and-sponsor-invoices`
> **Base:** `main` at commit `361aabe`
> **Status:** draft PR — operator merges manually per operating-model §14
> **Date:** 2026-05-19

## Scope

Adds the normalised `Sponsor` entity and the `SponsorInvoice` billing ledger
that closes the per-batch finance scope described in
`docs/SJMS-5-BUILD-QUEUE.md` Phase 1 §1B:

> **1B.** Sponsors and sponsor agreements. Models: `Sponsor`,
> `SponsorAgreement`, `SponsorInvoice`. FINANCE-gated.

`SponsorAgreement` already existed (Phase 18A heritage from SJMS-2.5) but
carried `sponsor_name` / `sponsor_type` as denormalised columns. Phase 1B
introduces a proper system-of-record for sponsoring organisations while
keeping the existing denormalised columns intact so no live data path
breaks.

## Schema changes

| Item | Change |
|---|---|
| `enum SponsorInvoiceStatus` | New: `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`. |
| `model Sponsor` | New. Normalised organisation row with name, sponsorType (reuses the existing `SponsorType` enum), denormalised contact + address fields, taxRef, isActive boolean, notes (Text), audit fields, `deletedAt` (soft delete). Relations: `agreements: SponsorAgreement[]`, `invoices: SponsorInvoice[]`. Indexes on `sponsorType` + `isActive`. |
| `model SponsorAgreement` | Adds nullable `sponsorId String?` FK + `sponsor Sponsor?` relation + `invoices SponsorInvoice[]` back-reference + `@@index([sponsorId])`. The legacy `sponsorName` / `sponsorType` columns remain — backfill is sequenced to a separate Phase 1 follow-on once the operator-facing Sponsor management UI lands. The FK uses `ON DELETE SET NULL` so deleting a Sponsor never orphans an agreement. |
| `model SponsorInvoice` | New. Invoice from FHE → sponsor (distinct from the student-facing `Invoice` table). Fields: id, sponsorId FK (required), sponsorAgreementId FK (optional, `SetNull` on delete), unique invoiceNumber, issueDate, dueDate, academicYear, amount + paidAmount (Decimal 10,2), currency (default GBP), status, sentDate, notes (Text), audit fields, `deletedAt`. Indexes on `sponsorId`, `sponsorAgreementId`, `status`, `academicYear`. |

Migration: `prisma/migrations/20260519100000_sponsors_and_sponsor_invoices/migration.sql` — purely additive (one new enum, two new tables, one nullable FK on an existing table).

## Files added

| File | Purpose |
|---|---|
| `prisma/migrations/20260519100000_sponsors_and_sponsor_invoices/migration.sql` | Forward-only SQL for the three schema additions. |
| `server/src/repositories/sponsor.repository.ts` | CRUD + `findByName` + soft-delete. Default include returns a `_count` projection of agreements + invoices for the list/detail surface. |
| `server/src/repositories/sponsorInvoice.repository.ts` | CRUD + `findByInvoiceNumber` (unique-number idempotency lookup) + soft-delete. Default include resolves the sponsor row and the optional sponsorAgreement (with student/person) for the detail surface. |
| `server/src/api/sponsors/sponsors.{router,controller,service,schema}.ts` | Standard CRUD module. `POST` / `PATCH` / `DELETE` FINANCE-role gated; hard `DELETE` SUPER_ADMIN-only because the repo path is `softDelete()` (logical retire). The service emits `sponsor.created` / `sponsor.updated` / `sponsor.status_changed` (when `isActive` flips) / `sponsor.deleted`. |
| `server/src/api/sponsor-invoices/sponsor-invoices.{router,controller,service,schema}.ts` | Standard CRUD module. The `create` path validates that the referenced `sponsorId` resolves to a live Sponsor (ValidationError otherwise) and that `invoiceNumber` does not already exist (ValidationError on conflict — the unique constraint is enforced at the DB level too). Service emits `sponsor_invoice.created` / `sponsor_invoice.updated` / `sponsor_invoice.status_changed` / `sponsor_invoice.deleted`. |
| `server/src/__tests__/unit/sponsors.service.test.ts` | 11 service-orchestration cases. |
| `server/src/__tests__/unit/sponsor-invoices.service.test.ts` | 11 service-orchestration cases. |
| `evidence/phase-1/1b-sponsors-and-sponsor-invoices.md` | This document. |

## Files modified

| File | Change |
|---|---|
| `prisma/schema.prisma` | + `SponsorInvoiceStatus` enum, + `Sponsor` model, + `SponsorInvoice` model, + `sponsorId String?` FK on SponsorAgreement, + `invoices SponsorInvoice[]` reverse relation on both Sponsor and SponsorAgreement. |
| `server/src/utils/repository-sort-allow-lists.ts` | + `SPONSOR_SORT` (`id`, `name`, `sponsorType`, `isActive`, `country`, audit fields), + `SPONSOR_INVOICE_SORT` (`id`, `invoiceNumber`, `issueDate`, `dueDate`, `amount`, `paidAmount`, `status`, `academicYear`, audit fields). |
| `server/src/utils/webhooks.ts` | + 8 dedicated webhook routes — `sponsor.{created,updated,status_changed,deleted}` and `sponsor_invoice.{created,updated,status_changed,deleted}`. One path per workflow, matching the existing finance domain pattern. |
| `server/src/api/index.ts` | + imports + mounts for `sponsorsRouter` (`/v1/sponsors`) and `sponsorInvoicesRouter` (`/v1/sponsor-invoices`). |
| `server/src/api/sponsor-agreements/sponsor-agreements.schema.ts` | + `sponsorId` accepted on `createSchema` (optional) and `updateSchema` (optional, nullable). The legacy denormalised `sponsorName` / `sponsorType` fields remain accepted so existing API consumers keep working. |
| `scripts/check-docs-truth.mjs` | Bumped `expectedModels` 197 → 199 and `expectedRouters` 57 → 59. |
| `CLAUDE.md` Target Metrics | Bumped model count 197 → 199, router count 57 → 59. |

## Verification

All gates run from `/home/user/SJMS-5` on the `phase-1b/sponsors-and-sponsor-invoices` branch.

| Gate | Result |
|---|---|
| Prisma validate (`./node_modules/.bin/prisma validate` with stub URLs) | ✓ `The schema at prisma/schema.prisma is valid` |
| Prisma generate (`./node_modules/.bin/prisma generate` with stub URLs) | ✓ Generated v6.19.3 in 1.06s |
| Server tsc (`cd server && npx tsc --noEmit`) | ✓ exit 0 |
| Server Vitest full suite (`cd server && npx vitest run`) | ✓ **775 / 775 passing across 49 files** (+22 new tests in this batch) |
| New unit tests in isolation (`npx vitest run src/__tests__/unit/sponsors.service.test.ts src/__tests__/unit/sponsor-invoices.service.test.ts`) | ✓ 22 / 22 passing |
| docs-truth (`node scripts/check-docs-truth.mjs`) | ✓ all checks pass (model count 199, router count 59) |
| Gate 4 — no direct Prisma in services | ✓ `grep -rn "prisma\." server/src/api/sponsors/ server/src/api/sponsor-invoices/` returns no results outside type imports |
| Gate 9 — repo hygiene | ✓ no `.claude/worktrees/`, no stray `*.txt` |

## Out of scope (deferred)

- **Backfill of legacy `SponsorAgreement.sponsor_name` rows into Sponsor rows.** The new `sponsorId` FK is nullable so existing agreements keep working. A backfill batch can resolve duplicates once the operator-facing Sponsor management UI lands (Phase 1F or a Phase 9 portal task).
- **Sponsor-invoice ↔ payment allocation.** The Phase 18C `payments` pipeline only knows about student-side `Invoice` rows. Wiring SponsorInvoice into the allocation flow (so a sponsor cheque covers tranches across many students) is sequenced to **Batch 1E** (ledger anomaly detection + reconciliation surface) — that batch is the natural carrier because it already touches the cross-account aggregation surface.
- **Auto-generation of SponsorInvoice rows from a SponsorAgreement schedule** (mirroring the Phase 18D PaymentPlan → PaymentInstalment generator). The schema supports it, but the operator-side UX is still in design.
- **Frontend surface for Sponsor / SponsorInvoice management.** The endpoints are testable via API; the staff portal screens land in **Batch 1F** (finance dashboards).
- **Sponsor merge / dedupe.** The new `findByName()` repo helper is the foundation; the operator-facing merge UI is a Phase 21 portal-completion task.
