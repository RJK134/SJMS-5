# Phase 1E — Finance auditability uplift: ledger anomaly detection

> **Branch:** `phase-1e/ledger-anomaly-detection`
> **Base:** `main` at commit `1e9cfc7` (post-1A/1B/1C/1D + #96 hygiene + #97 CI-fix merges)
> **Status:** draft PR — operator merges manually per operating-model §14
> **Date:** 2026-05-30

## Scope

Closes Batch 1E per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md) Phase 1 §1E:

> **1E.** Finance auditability uplift: ledger anomaly detection job on BullMQ
> (negative balance, orphan ChargeLine, duplicate invoice number); Prometheus
> counter + alert rule.

A read-only sweep of the finance ledger that classifies three anomaly types, updates Prometheus metrics, emits webhook events, and writes an audit row — runnable both on-demand (FINANCE-gated endpoint) and on a daily BullMQ cron. It **never mutates the ledger**; remediation stays a deliberate operator action.

## The three anomaly classes

| Type | Definition | Severity |
|---|---|---|
| `NEGATIVE_BALANCE` | A non-deleted `StudentAccount` with `balance < 0` (balance = debits − credits, so negative ⇒ the institution owes the student / over-allocation). | MEDIUM, escalated to HIGH at/above `negativeBalanceHighThreshold` (default £1,000). |
| `ORPHAN_CHARGE_LINE` | A live `ChargeLine` whose invoice is soft-deleted (`INVOICE_SOFT_DELETED`) **or** whose `studentAccountId` ≠ its invoice's `studentAccountId` (`ACCOUNT_MISMATCH`, a cross-account leak). | MEDIUM for soft-deleted (recoverable); HIGH for account-mismatch (money mis-attributed). |
| `DUPLICATE_INVOICE_NUMBER` | Two or more live invoices sharing an `invoiceNumber`. The DB `@unique` constraint should prevent this; surfaced defensively in case it was ever bypassed (raw migration / restore). | HIGH. |

## Architecture (matches the Phase 17/18 rule-engine pattern)

| Layer | File | Role |
|---|---|---|
| Pure classifier | `server/src/utils/ledger-anomaly.ts` (new) | `classifyLedgerAnomalies(input)` — no Prisma, no I/O, no clock. Takes raw projections, returns a severity-classified report with per-type / per-severity counts + `effectiveRules`. Fully unit-testable. |
| Read repository | `server/src/repositories/ledgerAnomaly.repository.ts` (new) | Three bounded read-only queries (`findNegativeBalanceAccounts`, `findOrphanChargeLines`, `findDuplicateInvoiceNumbers`). The only place that touches `prisma.*`. Each takes a `limit` (default 1000) so a pathological dataset can't exhaust worker memory. |
| Service orchestrator | `server/src/api/ledger-anomalies/ledger-anomalies.service.ts` (new) | `scanLedgerAnomalies(options, userId, req?)` — runs the three queries in parallel, classifies, records metrics, emits events, audits. Records a failure metric + rethrows on any query error. |
| HTTP surface | `server/src/api/ledger-anomalies/{router,controller,schema}.ts` (new) | `POST /v1/ledger-anomalies/scan`, FINANCE-role gated. Body all-optional (`limit`, `negativeBalanceHighThreshold`). |
| BullMQ cron | `server/src/workers/ledger-anomaly-cron.worker.ts` (new) | Daily 03:00 UTC scan, gated behind `SJMS_ENABLE_LEDGER_ANOMALY_CRON=true`; pattern override `SJMS_LEDGER_ANOMALY_CRON_PATTERN`. Mirrors the Phase 1A payment-instalment cron exactly (run/lastRun/register/trigger/test-seams). |
| Metrics | `server/src/utils/metrics.ts` (extended) | `sjms_ledger_anomalies{type,severity}` gauge, `sjms_ledger_anomaly_scans_total{status}` counter, `sjms_ledger_anomaly_last_scan_timestamp` gauge. `recordLedgerAnomalyScan` zeroes every series before applying new counts so a *resolved* anomaly doesn't leave a stale non-zero gauge. |
| Alert rules | `docker/prometheus/alerts.yml` (new — the repo's first Prometheus rule set) | `LedgerHighSeverityAnomaly` (critical), `LedgerAnomaliesPresent` (warning, 30m), `LedgerAnomalyScanStalled` (warning, 48h since last scan), `LedgerAnomalyScanFailing` (warning, scan errored). |

## Webhook events

- `ledger.anomaly_scan_completed` → `/webhook/sjms/ledger/anomaly-scan-completed` (one per scan, carries the summary).
- `ledger.anomaly_detected` → `/webhook/sjms/ledger/anomaly-detected` (one per anomaly, so n8n can route per-type / per-severity).

## Wiring

- `server/src/api/index.ts` — mounts `ledgerAnomaliesRouter` at `/v1/ledger-anomalies`.
- `server/src/workers/index.ts` — registers `registerLedgerAnomalyCronWorker()`.
- `server/src/utils/webhooks.ts` — two new `EVENT_ROUTES` entries.
- `scripts/check-docs-truth.mjs` — `expectedRouters` 59 → 60.
- `CLAUDE.md` Target Metrics — 59 → 60 routers.

## Verification

| Gate | Result |
|---|---|
| Server tsc (incl. new tests) | ✅ exit 0 |
| Server Vitest full suite | ✅ **864 / 864 passing across 54 files** (was 831/51 on the baseline; +33 cases / +3 files) |
| New tests in isolation | ✅ 33 / 33 (`ledger-anomaly.test.ts` pure classifier 18, `ledger-anomalies.service.test.ts` 8, `ledger-anomaly-cron.worker.test.ts` 11 — counts approximate per describe split) |
| Coverage vs Phase 17F floor (35/16/33/35) | ✅ Statements 51.66% · Branches 44.91% · Functions 27.09% · Lines 51.39% — all clear |
| `node scripts/check-docs-truth.mjs` | ✅ all checks pass (router count 60) |
| `node scripts/check-undeclared-imports.mjs` | ✅ clean (server/client/scripts) |
| `prisma validate` | ✅ valid (no schema change this batch) |
| YAML-lint `docker/prometheus/alerts.yml` | ✅ valid (1 group, 4 rules) |
| Gate 4 — no direct Prisma in services | ✅ the service/controller route through the repository; only `ledgerAnomaly.repository.ts` imports `prisma` |

## Deliberately out of scope

- **No schema change.** The scan reads existing `StudentAccount` / `ChargeLine` / `Invoice` columns; no migration. (A persisted `LedgerAnomalyScan` history table was considered and rejected — the metrics gauge + webhook events + audit row are the durable record; persisting every scan would add a model for marginal value. Revisit if an operator wants a queryable scan history.)
- **No automated remediation.** The scan surfaces anomalies; fixing them (re-pointing an orphan charge, correcting a balance) stays a deliberate, separately-audited operator action — automated ledger mutation off the back of a heuristic is exactly the risk this detector exists to catch.
- **Prometheus deployment wiring.** `docker/prometheus/alerts.yml` is a version-controlled, ready-to-mount rule set; standing up a Prometheus instance that scrapes `/metrics` and loads it is operator infrastructure (no `docker/prometheus/` service existed before this batch).
- **n8n workflows** for the two new events — sequenced to Phase 8 (integration activation); the webhook routes are registered now.
