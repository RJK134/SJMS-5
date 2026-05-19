# SJMS-5 — Known Issues Register

Living document tracking known defects that are **deliberately deferred** rather than fixed in the active phase. Each entry has a target resolution phase.

**Scope rule:** anything listed here must have a clear reason for deferral (out-of-scope for the current phase, blocked on another piece of work, or explicitly accepted as tech debt). Items that should be fixed in the active phase do **not** belong here.

## Phase 0 — COMPLETE on `main` (2026-05-19)

All 14 canonical batches merged. Verification on `main` at commit `0e2761f`:

```
npx tsc --noEmit       → exit 0
npx vitest run         → 46 files / 740 tests passing
npx prisma validate    → schema valid
```

| Batch | PR | Merge SHA | Scope |
|---|---|---|---|
| 0A1 | (workflow) | `7d0c6ac` | Bootstrap SJMS-2.5 spine import |
| 0A2 | #38 | `167d9ad` | Surgical rebrand SJMS-2.5 → SJMS-5 |
| 0B | #40 | (squashed into umbrella) | 18B + 18C finance absorption verification |
| 0C | #73 | `0e2761f` | Cryptobox primitive + MinIO 4-bucket layout |
| 0D | #70 | `5d81938` | BullMQ + Redis worker scaffolding |
| 0E | #67 | `ef85694` | k6 load-test scenarios + nightly CI |
| 0F | #44 | `17b2727` | Remove static-secret JWT fallback (fail closed) |
| 0G | #45 | `ed2c00f` | Keycloak realm — MFA + email verification + SMTP |
| 0H | #41 | `0242d09` | n8n header `x-internal-key` → `x-internal-service-key` |
| 0I | #69 | `e1928a5` | CI baseline green — root deps + lockfile reconcile |
| 0J | #48 | `a89a1eb` | Closeout — KI register reconciliation + evidence pack index |
| 0K | #43 | `1193786` | Governance — LICENSE + CODEOWNERS + branch-protection ratchet |
| 0L | #71 | `f6a3ce3` | Transactional outbox + worker (load-bearing) |
| 0M | #42 | `7ff4624` | Supply-chain hardening (pin `:latest`, SBOM, Trivy, Checkov) |
| 0N | #72 | `a3369d0` | Dependabot alerts enforcement + BugBot wiring |

KIs **fully closed** at Phase 0 merge — moved to the [Closed](#closed) section below:

- KI-S5-006 / KI-S5-307 (JWT fallback) → 0F
- KI-S5-007 (Keycloak MFA) → 0G
- KI-S5-008 / KI-S5-108 (n8n header) → 0H
- KI-S5-305 (`:latest` image pins) → 0M
- KI-S5-308 (SBOM) → 0M
- KI-S5-309 (container scan) → 0M
- KI-S5-301 (transactional outbox missing) → 0L
- KI-S5-314 (n8n circuit breaker) → 0L (subsumed by outbox)
- KI-S5-303 (Dependabot alerts 403) → 0N
- KI-S5-304 (plaintext secrets in DB) → 0C primitive shipped; field-level migration follows in Phase 1
- KI-S5-002 (MinIO presigned upload) → 0C wired; Phase 9 ships; Phase 12 hardens
- KI-S5-004 (npm audit baseline) → 0I
- KI-S5-201 (BullMQ workers on Vercel) → 0D resolved by deploying worker process per [`docs/architecture/outbox-worker-hosting.md`](architecture/outbox-worker-hosting.md)

KIs **partially closed** — structural change in place, operator action remains:

- KI-S5-302 (bus-factor 1) → 0K shipped `@SECOND_OWNER` placeholder; operator action: replace with Freddie's GitHub login before Phase 1 closes.
- KI-S5-306 (LICENSE + repo description) → 0K shipped `LICENSE`; operator action: set GitHub repo description on Settings → General.

## Operator action items at Phase 0 close

| # | Action | Notes |
|---|---|---|
| 1 | Replace `@SECOND_OWNER` in `.github/CODEOWNERS` | Required before Phase 1 closes; honest 2-reviewer protection depends on this |
| 2 | Set GitHub repo description on Settings → General | Closes the visible-half of KI-S5-306 |
| 3 | Apply codified branch protection | `gh api -X PUT /repos/RJK134/SJMS-5/branches/main/protection --input scripts/governance/protection.json` + the separate `required_signatures` POST |
| 4 | Stand up Railway worker host | Per [`docs/architecture/outbox-worker-hosting.md`](architecture/outbox-worker-hosting.md) — needed before any outbox event delivers in production |
| 5 | Configure Keycloak `sjms-5-load-test` confidential client | Unblocks the k6 nightly job (PR #46 / batch 0E) |
| 6 | Set SMTP password in Keycloak admin console | Replaces the `smtp.example.com` placeholder shipped by 0G |
| 7 | Enable Dependabot alerts in repo Settings → Code security | The `security-meta-check.yml` workflow (0N) will then turn green |

---

---

## Carried over from SJMS-2.5

| ID | Description | Deferral reason | Target phase |
|---|---|---|---|
| KI-S5-001 (was KI-P10b-001) | Finance sub-domains: sponsors, bursaries, refunds incomplete | SJMS-2.5 Phase 18E | Phase 1 (1B/1C/1D) |
| KI-S5-002 (was KI-P10b-002) | MinIO presigned upload flow not wired end-to-end | SJMS-2.5 Phase 21 | Phase 0 wires (0C); Phase 9 ships (9B); Phase 12 hardens (12H) |
| KI-S5-003 (was KI-P10b-003) | Teaching-assignment model + academic scoping | SJMS-2.5 Phase 21 | Phase 9 (9A) |
| KI-S5-004 (was KI-P15-001) | npm audit baseline triage outstanding | SJMS-2.5 | Phase 0 (0I) |
| KI-S5-005 (was KI-P15-002) | ESLint baseline + ratchet to blocking gate | SJMS-2.5 | Phase 3 (3H) — blocking from Phase 3 onward |
| KI-S5-006 (was Phase 15B STOP-gate) | Static-secret JWT fallback in production code path | SJMS-2.5 Phase 15B | **Phase 0 — pending closure via PR #44 (batch 0F)** |
| KI-S5-007 (was Phase 15B sub) | MFA not enforced in Keycloak realm | SJMS-2.5 Phase 15B | **Phase 0 — pending closure via PR #45 (batch 0G)** |
| KI-S5-008 (was Phase 20 risk) | n8n header-name mismatch (`x-internal-key` vs `x-internal-service-key`) | SJMS-2.5 Phase 20 | **Phase 0 — pending closure via PR #41 (batch 0H)** |
| KI-S5-009 (was n8n activation) | 62 n8n workflows not provisioned against live n8n instance | SJMS-2.5 Phase 20 | Phase 8 |
| KI-S5-010 (was Phase 21A) | WCAG 2.2 AA evidence pack (ratcheted from 2.1) | SJMS-2.5 Phase 21 | Phase 9 (9E) |
| KI-S5-011 (was Phase 22) | Analytics / BI / dashboards | SJMS-2.5 Phase 22 | Phase 10 |

## Carried over from SJMS v4-integrated

| ID | Description | Source | Target phase |
|---|---|---|---|
| KI-S5-101 | `HesaReturns` page throws TypeError on seeded payload (undefined `toLocaleString` on missing numerator) | v4 live build | Phase 3 (3G) |
| KI-S5-102 | `/staff/finance-overview` returns 404 against seeded data | v4 live build | Phase 1 (1F) |
| KI-S5-103 | SAML federation claimed in v4 README but not implemented | v4 README vs code | Phase 12 (12G) |
| KI-S5-104 | Multi-tenancy claim outpaces enforcement (tenantId only on User) | v4 schema | Phase 2 |
| KI-S5-105 | v4 README understates schema size by ~⅓ and shallow role catalogue | v4 README | Phase 0 (docs:check enforces) |
| KI-S5-106 | v4 observability lighter than 2.5 (no Prometheus, no auto-OpenAPI) | v4 server/src/utils | Phase 0 (replaced with 2.5 stack) |
| KI-S5-107 | v4 lint and coverage gates not enforced | v4 | Phase 0 (replaced with 2.5 stack) |
| KI-S5-108 | v4 n8n template header still `x-internal-key` | v4 n8n-workflows | Phase 0 — pending closure via PR #41 (batch 0H) |

## Net-new for SJMS-5

| ID | Description | Reason | Target phase |
|---|---|---|---|
| KI-S5-201 | BullMQ workers cannot run on Vercel (no long-running process) | Vercel serverless constraint | Phase 0 — deploy workers to Railway/Render/Fly |
| KI-S5-202 | Migration history is fresh (no SJMS-2.5 or v4 migration replay) | Convergence artefact | Phase 12 — migration rehearsal from SITS/Banner extract validates approach |
| KI-S5-203 | Multi-tenancy brought forward to Phase 2 (was post-Phase 23 in SJMS-2.5) | Required before functional layering | Phase 2 |
| KI-S5-204 | AI-native uplift scope and ethics review | Net-new capability | Phase 11 |
| KI-S5-205 | Dataset extension after Phase 0 spine import — add generators for the ~22 net-additive SJMS-2.5 ledger entities (StudentAccount, ChargeLine, PaymentAllocation, PaymentInstalment, SponsorAgreement, RefundApproval, ClearanceCheck, Award, AwardRecord, Classification, Transcript, TranscriptLine, AnonymousMarkingAllocation, SecondMarkingAllocation, ExamBoardDecision, ProgressionRule and ClassificationRule reconciliation) | Dataset generator targets v4-integrated as it stands today; the richer 2.5 ledger lands as Phase 0 spine import and the generator extends in a half-day follow-on PR. The brief's chart-of-accounts / GL / journal / payroll / grant-accounting ambitions are dropped as out-of-SJMS-scope per [`docs/dataset/SCHEMA-MAPPING.md`](dataset/SCHEMA-MAPPING.md) §3 | Follow-on PR opens after Phase 0 `0001_init` migration commits |

## Carried over from deep review of SJMS-2.5 (2026-04-29)

| ID | Description | Deep-review ref | Target phase |
|---|---|---|---|
| KI-S5-301 | **Transactional outbox for event delivery missing — single largest reliability gap** | P0 #4 / Prompt D | **Phase 0 (0L) — load-bearing** |
| KI-S5-302 | Bus-factor 1: single human contributor, single CODEOWNER, admin bypass enabled on main, no commit signing | P0 #1 + #6 / Prompt A | **Phase 0 — pending closure via PR #43 (batch 0K, partial: structural fix in place; operator action to replace `@SECOND_OWNER`)** |
| KI-S5-303 | Dependabot alerts API returns 403 ("disabled for this repository") — alerts toggled off in repo settings | P0 #2 / Prompt B | Phase 0 (0N — pending; requires repo Settings change) |
| KI-S5-304 | Plaintext secrets in DB: `WebhookSubscription.secretKey`, `UserSession.sessionToken` stored as TEXT | P0 #3 / Prompt C | Phase 0 (0C — pending; data migration, deferred for operator review) |
| KI-S5-305 | `minio/minio` and `n8nio/n8n` pinned to `:latest` — silent supply-chain risk | P0 #5 / Prompt E | **Phase 0 — pending closure via PR #42 (batch 0M)** |
| KI-S5-306 | No LICENSE file; GitHub repo description is placeholder `"SJMS "` | P0 #6 | **Phase 0 — pending closure via PR #43 (batch 0K, partial: LICENSE shipped; operator action to set repo description)** |
| KI-S5-307 | Static `JWT_SECRET` fallback in auth middleware still exists outside dev | P0 #7 | **Phase 0 — pending closure via PR #44 (batch 0F)** |
| KI-S5-308 | No SBOM (CycloneDX) generation in CI | P1 #11 | **Phase 0 — pending closure via PR #42 (batch 0M)** |
| KI-S5-309 | No container image scan (Trivy/Grype) in CI | P1 #10 | **Phase 0 — pending closure via PR #42 (batch 0M)** |
| KI-S5-310 | No image signing (cosign / SLSA provenance) | P2 #30 | Phase 12 (12K) |
| KI-S5-311 | No license-policy SPDX gate in CI | P2 #29 | Phase 12 (12J) |
| KI-S5-312 | Sparse optimistic locking — `Mark`, `ModuleResult`, `Invoice`, `Payment`, `ExamBoardDecision`, `AssessmentAttempt`, `Enrolment` are race-prone without `version` column | P1 #17 / Prompt I | Phase 1 (1H) |
| KI-S5-313 | `AuditLog.userId` is free-text string, not FK on `User` | P1 #18 | Phase 1 (1I) |
| KI-S5-314 | No transactional outbox for n8n / external HTTP calls — no circuit breaker | P1 #15 | Phase 0 (0L) — outbox subsumes |
| KI-S5-315 | Schema header banner drift (183 stated vs 197 actual) — docs-truth advisory | P3 advisory | Phase 0 (drive-by in 0A rebrand) |
| KI-S5-316 | `cursor-agent-manual.yml` workflow fails on push events (not in required set) | P3 #32 | Phase 0 (0I, drive-by) |
| KI-S5-317 | Zod version split: client v3.25 vs root/server v4 | P3 #33 | Phase 0 (0A, drive-by) |
| KI-S5-318 | ~5–10% of FKs rely on database default `onDelete` rather than explicit `Cascade`/`SetNull`/`Restrict` | P3 #34 | Phase 2 (alongside tenantId rollout) |
| KI-S5-319 | Single Redis instance / single DB — no per-purpose namespacing (rate-limit / cache / sessions) | P3 #35 | Phase 10 (alongside observability) |
| KI-S5-320 | Client tests thin — 3 Playwright specs only, manual-only (not in CI) for a 129-page SPA | P2 #23 / Prompt J | Phase 9 (9F) |
| KI-S5-321 | No alerting / SLO definitions in repo — no Grafana/Prometheus dashboards-as-code | P2 #22 | Phase 10 (10F) |
| KI-S5-322 | No OpenTelemetry tracing on server or client | P2 #21 | Phase 10 (10F) |
| KI-S5-323 | No DR / BC posture: backup not tested, no RTO/RPO documented, no runbook | P2 #27 | Phase 12 (12A) |
| KI-S5-324 | No accessibility (WCAG 2.2 AA) audit or a11y CI gate | P2 #26 | Phase 9 (9E) |
| KI-S5-325 | No privacy posture pack: no DPIA, ROPA, or subject-rights workflow | P2 #28 | Phase 12 (12I) |
| KI-S5-326 | LLM-based PR reviewer (BugBot / CodeRabbit / Cursor) not posting GitHub-API-visible reviews on PRs | P3 #36 | Phase 0 (0N) |
| KI-S5-327 | `n8n-workflows/` duplicated between `server/src/workflows/` and root — no single source of truth | P3 #37 | Phase 8 (alongside activation) |

---

## Closed

Net-new entries created and closed during the 2026-05-18 overnight Phase 0 build (the seven batch PRs that ship the closures are still draft pending operator merge):

- KI-S5-329 (new — load-test k6 scenarios scaffolding) — pending closure via PR #46 (batch 0E).
- KI-S5-330 (new — GitGuardian secret scanner config) — pending closure via PR #43 (batch 0K, `.gitguardian.yml`).

Phase 0 closure pattern: every KI flagged "pending closure via PR #N" above will be moved into this section by the operator at umbrella PR #39 merge time. Each entry will record:

- ID and one-line description
- Closing batch (e.g. `0F`)
- Closing PR number (`#44`)
- Squash-merge commit SHA on `phase-0/spine-import`
- Squash-merge commit SHA on `main` (set when umbrella PR #39 merges)
- Date closed (UK timezone)

The structure is per [`SJMS-5-OPERATING-MODEL.md`](SJMS-5-OPERATING-MODEL.md) §8.

---

## KI lifecycle

Per [`SJMS-5-OPERATING-MODEL.md`](SJMS-5-OPERATING-MODEL.md) §8, an entry requires:

- Issue ID (`KI-S5-<number>`)
- One-line description
- Reason for deferral (out of phase scope, blocked, accepted tech debt)
- Target resolution phase
- Closed-by reference when closed (commit SHA or PR)
