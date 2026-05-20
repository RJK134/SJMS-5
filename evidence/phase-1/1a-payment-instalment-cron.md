# Phase 1A — Payment-instalment cron generator

**Date captured:** 2026-05-19
**Captured by:** Claude (Opus 4.7) under "do 1A" instruction after Phase 0 closed on `main`
**Branch:** `phase-1a/payment-instalment-cron`

## Build-queue acceptance restated

Per the Phase 1 plan in [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md#phase-1--finance-closeout-expanded) batch 1A:

> Payment plans (PaymentPlan + PaymentInstalment service + cron generator). Closes 2.5 Phase 18D.

The PaymentPlan + PaymentInstalment service surface and `generatePlanSchedule` utility shipped via the spine import (SJMS-2.5 Phase 18D, imported in Phase 0A1). Phase 18D's own "Deliberately out-of-scope" note carries forward:

> Auto-generation of ChargeLines when an instalment falls due (so the 18C allocator picks them up without an operator intervention). Sequenced to a Phase 20 n8n scheduled job — `payment_instalment.due` would fire, an n8n workflow would call `POST /v1/finance/charge` …, and the open-charges set would naturally absorb the next allocation.

**This batch closes that deferred work**, pulling it forward from Phase 20 n8n into Phase 1A as a BullMQ cron now that 0D's worker scaffolding is on `main`.

## What ships

| File | Change |
|---|---|
| `server/src/repositories/chargeLine.repository.ts` | New `findByInstalmentMarker(studentAccountId, instalmentId)` — idempotency helper that looks for an existing non-deleted ChargeLine whose `description` carries the `[instalment:${id}]` marker. Used by the cron to detect a previous run's output and skip rather than duplicate. |
| `server/src/api/payment-instalments/payment-instalments.service.ts` | New `processOverdueInstalments(options, userId, req)` service method (~170 LoC). Loads overdue PENDING instalments via `repo.findOverdue`, per-row creates a ChargeLine via `financeRepo.createCharge` with an embedded `[instalment:${id}]` idempotency marker, emits `payment_instalment.due` per row and `payment_instalment.cron_processed` once at the end, audits the run as a `PaymentInstalmentCron` subject. Per-row failures are isolated — one bad row does not abort the cohort. |
| `server/src/workers/payment-instalment-cron.worker.ts` | New worker. Daily BullMQ cron at `30 2 * * *` (02:30 UTC); env-gated by `SJMS_ENABLE_PAYMENT_INSTALMENT_CRON=true` so dev/test/Vercel never register. Operator on-demand path via `triggerProcessOverdueNow()`. Tracks `lastRun` for `/health` consumers. |
| `server/src/workers/index.ts` | Registers `registerPaymentInstalmentCronWorker()` alongside the existing example + outbox workers. |
| `server/src/__tests__/unit/payment-instalments-cron.service.test.ts` | New file. 8 unit tests — empty-cohort, happy-path charge creation, marker presence in description, idempotent skip on re-run, per-row failure isolation, default `asOf=now()`, orphan-plan handling, cron-trigger forwarded to event payload. |
| `evidence/phase-1/1a-payment-instalment-cron.md` | This file. |

## Architecture notes

### Idempotency without a schema migration

The 18D out-of-scope note flags **`PaymentInstalment.chargeLineId` FK** as the proper-but-deferred linking pattern. Phase 1A holds that deferral and uses a **description-marker idempotency** instead:

- Cron writes `description = "Instalment ${n} of ${total} due ${YYYY-MM-DD} (plan ${planId}) [instalment:${instalmentId}]"`
- Re-runs query `chargeLineRepo.findByInstalmentMarker(studentAccountId, instalmentId)` which matches by `description: { contains: "[instalment:${id}]" }`
- Existing rows → `status: 'skipped'`, `chargeLineId` populated, no `financeRepo.createCharge` call

The marker is a single line of audit context inside the description string. A future phase can promote to the FK column without breaking the marker pattern (both can coexist during migration).

### The cron does NOT mutate the PaymentInstalment

The instalment stays `PENDING` until the operator calls the existing `recordPayment` bridge (18D). That bridge:

1. Calls `paymentService.allocateForPayment` (18C) which covers the new ChargeLine
2. Flips the PaymentInstalment to `COMPLETED` via the existing service `update()` path
3. Promotes the plan to `COMPLETED` when all instalments are done

The cron's single job is "**make the charge visible to the allocator**". Separation of concerns preserved.

### Audit + event surface

- `logAudit('PaymentInstalmentCron', asOf.toISOString(), 'CREATE', ...)` — synthetic subject type so the run is grep-distinguishable from per-row PaymentInstalment audits.
- `emitEvent('payment_instalment.due', ...)` per successful row — downstream n8n workflows wire student notifications, ledger anomaly detection, etc.
- `emitEvent('payment_instalment.cron_processed', ...)` once with the run-level summary — operator dashboards / health probes.

### Audit action choice

`AuditAction` enum is `CREATE | UPDATE | DELETE | VIEW | EXPORT` — no `EXECUTE`. Used `CREATE` here ("a new cron run was created") with the type-suffix `PaymentInstalmentCron` distinguishing it from per-row mutations. A Phase 12+ governance pass could extend the enum if `EXECUTE` proves useful elsewhere.

## Operator action items at merge

| # | Action | When |
|---|---|---|
| 1 | Set `SJMS_ENABLE_PAYMENT_INSTALMENT_CRON=true` on the Railway worker service | Before the daily 02:30 UTC schedule is wanted live |
| 2 | (Optional) Override `SJMS_PAYMENT_INSTALMENT_CRON_PATTERN` | Only if 02:30 UTC clashes with another scheduled job |
| 3 | Smoke-test via `triggerProcessOverdueNow()` once Railway picks up the new code | Verifies Redis + Postgres reach and the run-tracker shape |
| 4 | (Recommended) Add a Prometheus alert on `last_payment_instalment_cron_run.status === 'error'` for two consecutive runs | Phase 10 observability batch |

## Verification on this branch

```
$ cd server && npx tsc --noEmit
(exit 0)

$ cd server && npx vitest run
 Test Files  47 passed (47)
      Tests  748 passed (748)
```

- 8 new tests cover happy path, idempotency, per-row failure isolation, default `asOf`, orphan-plan handling.
- Existing 740 tests preserved — no regression.
- `tsc --noEmit` clean.

## Out of scope (sequenced to later batches)

- **`PaymentInstalment.chargeLineId` FK migration** — 18D deferred; pull forward to Phase 12 pilot-readiness alongside the schema-tightening pass.
- **`ACTIVE → DEFAULTED` plan auto-promotion** when an instalment lapses past dueDate — 18D out-of-scope. Best handled as a sibling cron in a later batch; current cron deliberately does not mutate plan state.
- **Per-tenant scheduling** — the cron runs realm-wide. Phase 2 multi-tenancy STOP-gated rollout will revisit.
- **n8n workflow JSONs** that consume the new `payment_instalment.due` event — Phase 8 owns n8n activation.
- **Operator UI** to view the chase list and manually trigger — Phase 9 staff portal completion.
- **Prometheus alerts on cron success/failure** — Phase 10 observability.

## Net Phase 1 effect

Batch 1A is `done` per the acceptance signal protocol. Closes the 18D deferral. The next Phase 1 batch ready to ship is **1B** (sponsors + SponsorAgreement) — independent of this batch.

The two other in-flight Phase 1 branches (`phase-1h/optimistic-locking`, `chore/audit-fk-1i-20260519`) are orthogonal to this work and can land in any order.
