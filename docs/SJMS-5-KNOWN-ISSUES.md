# SJMS-5 — Known Issues Register

Living document tracking known defects that are **deliberately deferred** rather than fixed in the active phase. Each entry has a target resolution phase.

**Scope rule:** anything listed here must have a clear reason for deferral (out-of-scope for the current phase, blocked on another piece of work, or explicitly accepted as tech debt). Items that should be fixed in the active phase do **not** belong here.

---

## Carried over from SJMS-2.5

| ID | Description | Deferral reason | Target phase |
|---|---|---|---|
| KI-S5-001 (was KI-P10b-001) | Finance sub-domains: sponsors, bursaries, refunds incomplete | SJMS-2.5 Phase 18E | Phase 1 |
| KI-S5-002 (was KI-P10b-002) | MinIO presigned upload flow not wired end-to-end | SJMS-2.5 Phase 21 | Phase 0 wires; Phase 9 hardens |
| KI-S5-003 (was KI-P10b-003) | Teaching-assignment model + academic scoping | SJMS-2.5 Phase 21 | Phase 9 |
| KI-S5-004 (was KI-P15-001) | npm audit baseline triage outstanding | SJMS-2.5 | Phase 0 |
| KI-S5-005 (was KI-P15-002) | ESLint baseline + ratchet to blocking gate | SJMS-2.5 | Phase 3 (blocking) |
| KI-S5-006 (was Phase 15B STOP-gate) | Static-secret JWT fallback in production code path | SJMS-2.5 Phase 15B | **Phase 0 — closed at import** |
| KI-S5-007 (was Phase 15B sub) | MFA not enforced in Keycloak realm | SJMS-2.5 Phase 15B | **Phase 0 — closed at import** |
| KI-S5-008 (was Phase 20 risk) | n8n header-name mismatch (`x-internal-key` vs `x-internal-service-key`) | SJMS-2.5 Phase 20 | **Phase 0 — closed at import** |
| KI-S5-009 (was n8n activation) | 62 n8n workflows not provisioned against live n8n instance | SJMS-2.5 Phase 20 | Phase 8 |
| KI-S5-010 (was Phase 21A) | WCAG 2.1 AA evidence pack | SJMS-2.5 Phase 21 | Phase 9 |
| KI-S5-011 (was Phase 22) | Analytics / BI / dashboards | SJMS-2.5 Phase 22 | Phase 10 |

## Carried over from SJMS v4-integrated

| ID | Description | Source | Target phase |
|---|---|---|---|
| KI-S5-101 | `HesaReturns` page throws TypeError on seeded payload (undefined `toLocaleString` on missing numerator) | v4 live build | Phase 3 |
| KI-S5-102 | `/staff/finance-overview` returns 404 against seeded data | v4 live build | Phase 1 (absorbed) |
| KI-S5-103 | SAML federation claimed in v4 README but not implemented | v4 README vs code | Phase 12 |
| KI-S5-104 | Multi-tenancy claim outpaces enforcement (tenantId only on User) | v4 schema | Phase 2 |
| KI-S5-105 | v4 README understates schema size by ~⅓ and shallow role catalogue | v4 README | Phase 0 (docs:check enforces) |
| KI-S5-106 | v4 observability lighter than 2.5 (no Prometheus, no auto-OpenAPI) | v4 server/src/utils | Phase 0 (replaced with 2.5 stack) |
| KI-S5-107 | v4 lint and coverage gates not enforced | v4 | Phase 0 (replaced with 2.5 stack) |
| KI-S5-108 | v4 n8n template header still `x-internal-key` | v4 n8n-workflows | Phase 0 (closed at import) |

## Net-new for SJMS-5

| ID | Description | Reason | Target phase |
|---|---|---|---|
| KI-S5-201 | BullMQ workers cannot run on Vercel (no long-running process) | Vercel serverless constraint | Phase 0 — deploy workers to Railway/Render/Fly |
| KI-S5-202 | Migration history is fresh (no SJMS-2.5 or v4 migration replay) | Convergence artefact | Phase 12 — migration rehearsal from SITS/Banner extract validates approach |
| KI-S5-203 | Multi-tenancy brought forward to Phase 2 (was post-Phase 23 in SJMS-2.5) | Required before functional layering | Phase 2 |
| KI-S5-204 | AI-native uplift scope and ethics review | Net-new capability | Phase 11 |

---

## Closed

None — Phase 0 approved and ready to execute.
