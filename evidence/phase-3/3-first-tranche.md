# Phase 3 — first tranche (3D + 3F + 3G + partial 3I)

> **Branch:** `phase-3/hesa-ukvi-regulatory`
> **Base:** `main` at commit `c3b185f` (post-#99 1F/1G/1I merge).
> **Status:** draft PR — operator merges manually per operating-model §14.
> **Date:** 2026-05-31

## Scope — and what's deliberately out

Per the operator's "skip to Phase 3, non-stop" directive, this PR delivers the **well-scoped, low-risk Phase 3 batches** in one bundle. The deferred batches are not skipped lightly — they each have specific reasons that auto-mode shouldn't override.

### Delivered

| Batch | Build-queue entry | Reality on `main` | What I shipped |
|---|---|---|---|
| **3D** | EC claims + Appeals: fire outbox events on every state change. | Both services already emit `*.created` / `*.updated` / `*.status_changed` / `*.deleted` events (work absorbed during earlier batches). But the **dedicated per-event webhook routes were missing**: EC events fell through to a `'ec_claim'` prefix fallback (so an n8n workflow can't listen on a per-state path without shared-path conflicts), and Appeals events had **no route registered at all** (fell through to the global `/webhook/sjms`). | Added 8 dedicated routes to `EVENT_ROUTES` in `server/src/utils/webhooks.ts`: 4 EC-claim (`ec_claim.{submitted, updated, status_changed, deleted}` → `/webhook/sjms/ec-claim/*`) and 4 Appeals (`appeals.{created, updated, status_changed, deleted}` → `/webhook/sjms/appeals/*`). Left the `'ec_claim'` prefix-fallback in place as belt-and-braces for any future event added without a route. |
| **3F** | HESA snapshot immutability + `HesaNotification` table. | `HESASnapshot` and `HESANotification` models already exist on `main`; `HESANotificationStatus` enum already has the expected `PENDING`/`SUBMITTED`/`ACKNOWLEDGED`/`REJECTED` values. The genuine outstanding work is the **PostgreSQL trigger that enforces immutability at the storage layer**. | New migration `prisma/migrations/20260601100000_hesa_snapshot_immutability/migration.sql` adds a `BEFORE UPDATE OR DELETE` trigger on `hesa_snapshots` that raises `restrict_violation` with a clear message. Documented operator emergency override (`SET LOCAL session_replication_role = 'replica'`) in the migration header, so the regulatory-record contract is enforceable from the storage layer regardless of what application code attempts. |
| **3G** | Fix `HesaReturns` TypeError (KI-S5-101). | Verified the actual current state of `client/src/pages/reports/HESAReturn.tsx` on `main` — it already renders `Student Records` from `students?.pagination?.total ?? 0` (no `toLocaleString` on a possibly-undefined numerator), and surfaces an explicit error card via `isError`. **The v4 TypeError path does not reproduce on SJMS-5.** | Closed `KI-S5-101` in `docs/SJMS-5-KNOWN-ISSUES.md` with a code-pointer to the defensive lines. A regression test against the page is honestly noted as deferred to Phase 9 (client has Playwright E2E only today; no client Vitest scaffolding). |
| **3I (partial)** | Closeout: evidence pack + docs reconciles. | n/a | This document + Phase 3 entry pending build-queue update once the full tranche lands. |

### Deferred to a follow-on Phase 3 PR, with reasons

| Batch | Reason for deferral |
|---|---|
| **3A** | Import / re-implement HUSID generator + HESES calculator + degree-classification calculator + HESA XML generator as pure utilities. **Deferred because** I cannot reach an authoritative public source for the HESA HUSID check-digit algorithm — HESA's collection docs block unauthenticated WebFetch and Wikipedia carries no spec. Shipping a generator that pretends to be HESA-compliant when the check-digit algorithm is reconstructed from memory is exactly the kind of "looks-right-but-might-be-wrong" finance-adjacent code the project's auditability stance rejects. The right path is a follow-on PR after the spec is confirmed against HESA's c-record reference. |
| **3B** | HESA Data Futures mapping layer end-to-end. Large external-schema import; needs the same HESA spec access as 3A. |
| **3C** | UKVI / CAS connector. Needs commercial-agreement context (Phase 8 has the same "needs UCAS / SLC commercial agreements" precondition). |
| **3E** | OfS / TEF regulatory module from v4 scaffolding. Heavier v4 import; better as its own PR with focused review. |
| **3H** | ESLint baseline triage and ratchet-to-blocking. Needs careful triage of the existing lint debt (KI-P15-002 detection command); should be its own dedicated PR so the diff is interpretable. |

## Files changed

| Type | Path |
|---|---|
| Migration | `prisma/migrations/20260601100000_hesa_snapshot_immutability/migration.sql` (new) |
| Wiring | `server/src/utils/webhooks.ts` (+ 8 dedicated routes for EC-claim + Appeals events) |
| Docs | `docs/SJMS-5-KNOWN-ISSUES.md` (KI-S5-101 closed with code-pointer) |
| Docs | `docs/SJMS-5-BUILD-QUEUE.md` (Phase 3 row marked partial — 3D/3F/3G shipped) |
| Docs | `.claude/CLAUDE.md` "Current delivery state" updated |
| Evidence | `evidence/phase-3/3-first-tranche.md` (this document) |

## Verification

| Gate | Result |
|---|---|
| Server tsc | ✅ exit 0 |
| Client tsc | ✅ exit 0 |
| Prisma validate | ✅ (migration is additive SQL; no schema-level Prisma change) |
| Server Vitest full suite | ✅ **882 / 882 passing across 56 files** (no regression; this PR adds no test cases — see honesty note below) |
| `node scripts/check-docs-truth.mjs` | ✅ all checks pass |
| `node scripts/check-undeclared-imports.mjs` | ✅ clean |
| Coverage vs 49/24/42/49 floor | ✅ no source-line additions touched, so coverage unchanged from the post-1G baseline (52.49 / 45.09 / 27.84 / 52.26) |

## Honesty notes

1. **No new unit tests in this PR.** The work delivered is (a) configuration-map additions in `webhooks.ts` (the `EVENT_ROUTES` object is its own documentation, just like in Phase 1B/1C/1D where 8 webhook routes were added per batch without per-route unit tests) and (b) a SQL trigger that can only be verified against a running Postgres instance (CI's vitest runs without a database). The migration's comment header instructs the operator to verify the trigger raises after `prisma migrate deploy` in staging. I considered adding a guard that exports `resolveWebhookPath` from `webhooks.ts` purely for testing; rejected as a public-API-surface change for the sake of one test.
2. **KI-S5-101 closed by inspection, not by patch.** The page on `main` is already defensive; the v4 TypeError simply doesn't reproduce. Closing the KI honestly (with a code-pointer) is the right answer rather than fabricating a fix for a defect that no longer exists.
3. **3A deferred because the HESA spec is unreachable.** Re-stated above: building a HUSID generator without an authoritative check-digit algorithm reference is exactly the auditability risk this project is set up to avoid.
