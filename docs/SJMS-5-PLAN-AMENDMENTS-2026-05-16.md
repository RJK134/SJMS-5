# SJMS-5 Plan Amendments — 2026-05-16

> **Status:** **APPROVED 2026-05-16** as Option 1 (refine plan before Phase 0).
>
> **Origin:** operator-supplied deep review of SJMS-2.5 (`sjms_repo_review.md`, 800 lines, dated 2026-04-29) plus three additional skill packages: `hesa-data-management`, `sjms-compliance-expert`, `sjms-data-migration-lead`. Plus the full SJMS-2.5 skills library README confirming 54 role personas across 5 categories.
>
> **Scope:** this document **amends** [`SJMS-5-SYNTHESIS-PLAN.md`](SJMS-5-SYNTHESIS-PLAN.md) at specific sections. On any conflict between the two, **this amendments doc wins** for the sections it touches; the unchanged sections of the synthesis plan remain authoritative.

---

## 1. Why these amendments

The original synthesis plan (PR #1, merged 2026-05-16) was built from the comparative analysis between SJMS-2.5 and SJMS v4-integrated. The deep repository review uploaded later that day brought three material additions that warrant absorption **before** Phase 0 begins:

1. **Transactional outbox for event delivery** — flagged in the deep review as "the single largest functional risk" and "the load-bearing concern" for stability. Webhook emission today is fire-and-forget with in-process retry only. HESA, UKVI, and finance events must not be lost. The original plan did not address this.
2. **Ten ready-to-paste remediation prompts** (A–J in the deep review §14) that map cleanly onto SJMS-5 phases. Most are absorbed into existing phases as additive batches; one (Prompt D, the outbox) is so foundational it needs Phase 0 status.
3. **A 54-role skills library** at `RJK134/SJMS-2.5/skills/` plus three new skill packages. Twelve **domain-lead briefs** (one per SJMS-5 phase) are committed in `docs/skills-leads/` as the operating handle for spawning subagents in design / review / cross-cutting work.

---

## 2. Synthesis-plan §4.7 (NEW) — Event delivery: the transactional outbox

The synthesis plan §4.6 stated "every mutation produces an audit-log row and a webhook event published to n8n". That contract stands. **How** the event reaches n8n is now specified by this section.

### 2.1 Problem

The SJMS-2.5 webhook utility (`server/src/utils/webhooks.ts`) emits events with three retries and HMAC signing, but the call is **synchronous-in-process**. If the API crashes mid-emit, or if the n8n endpoint is unreachable after three attempts, the event is silently lost. For HESA Data Futures returns, UKVI sponsored-student attestations, and finance ledger events, this is unacceptable.

### 2.2 Solution: transactional outbox + worker

A new Prisma model `OutboxEvent` is added to the SJMS-5 schema. Every mutation that emits an event writes the `OutboxEvent` row **inside the same Prisma transaction** as the business state change. A dedicated worker process (on a long-running host, not Vercel) drains the outbox with at-least-once semantics.

```prisma
model OutboxEvent {
  id            String        @id @default(cuid())
  tenantId      String        @default("fhe")
  aggregateType String
  aggregateId   String
  event         String
  payload       Json
  status        OutboxStatus  @default(PENDING)
  attempts      Int           @default(0)
  lastError     String?
  createdAt     DateTime      @default(now())
  processedAt   DateTime?

  @@index([status, createdAt])
  @@index([tenantId, status])
}

enum OutboxStatus {
  PENDING
  IN_PROGRESS
  DELIVERED
  DEAD
}
```

### 2.3 Delivery semantics

- Worker polls every 1 s for `PENDING` rows (LIMIT 100), claims via row-level lock `FOR UPDATE SKIP LOCKED`.
- Marks `IN_PROGRESS`, calls existing webhook signing logic with the corrected `x-internal-service-key` header.
- On success: `DELIVERED` with `processedAt`.
- On failure: increment `attempts`, exponential backoff (1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s, 1024s, 2048s — capped at ~34 minutes).
- After 12 attempts: `DEAD`. Surfaced via `GET /api/v1/admin/outbox?status=DEAD`. Manual replay via `POST /api/v1/admin/outbox/:id/replay` (SUPER_ADMIN only).

### 2.4 Admin surface

Two endpoints introduced in Phase 0:

- `GET /api/v1/admin/outbox` — list with filters (status, aggregateType, since). SUPER_ADMIN.
- `POST /api/v1/admin/outbox/:id/replay` — requeue a `DEAD` row to `PENDING`, audited. SUPER_ADMIN.

A Prometheus gauge `sjms_outbox_pending_total{tenant,event}` and counter `sjms_outbox_dead_total{tenant,event}` surface the queue state.

### 2.5 Migration impact

Every existing `emitEvent` call site in the SJMS-2.5 import must be refactored to pass the active Prisma `tx` and write to `OutboxEvent` instead of calling webhook delivery directly. This is mechanical but touches every router. **Phase 0 batch 0L** is the dedicated batch.

### 2.6 Why this is foundational, not a later phase

Webhook reliability is the substrate that HESA (Phase 3), Finance (Phase 1), UKVI (Phase 3), and every audited mutation depend on. Retrofitting the outbox after those domains land means rewriting the event path on a hot codebase. Doing it once in Phase 0 — when the codebase is the SJMS-2.5 import plus the v4 net-additive assets and **no new domain work has begun** — is cheaper and safer.

---

## 3. Synthesis-plan §4.6 amendment — webhook contract via outbox

Replace the bullet "every mutation produces an audit-log row and a webhook event published to n8n via the corrected header" with:

> **Webhook contract:** every mutation produces an audit-log row and an `OutboxEvent` row inside the same Prisma transaction. The outbox worker (separate process) delivers each event to n8n with HMAC-SHA256 signing, the corrected `x-internal-service-key` header, exponential-backoff retry, and a dead-letter status after 12 attempts. The catalogue of webhook events is the OpenAPI spec's `events` section, regenerated on every build.

---

## 4. Synthesis-plan §5 Phase 0 — expanded canonical batches

The original Phase 0 had 10 batches (0A–0J). The expanded Phase 0 has **14 batches (0A–0N)** absorbing the deep-review P0 items. Full text in [`SJMS-5-BUILD-QUEUE.md`](SJMS-5-BUILD-QUEUE.md). New batches:

- **0K — Governance: branch protection + bus-factor reduction.** Closes deep-review P0 #1 + #6. CODEOWNERS adds placeholder `@SECOND_OWNER`. Manual GitHub Settings change documented in `docs/operations/ci-and-branch-protection.md`. Adds LICENSE file (UNLICENSED / proprietary), real GitHub repo description.
- **0L — Transactional outbox + worker.** Closes deep-review P0 #4. New `OutboxEvent` model + migration + worker + admin endpoints + Prometheus instrumentation. Every imported router refactored to write outbox rows.
- **0M — Supply-chain hardening.** Closes deep-review P0 #5 + P1 #10–11. Pins `minio/minio` and `n8nio/n8n` to specific tags, adds Trivy container scan + CycloneDX SBOM generation in CI, adds Checkov on Docker/nginx configs.
- **0N — Dependabot alerts enforcement + BugBot equivalent.** Closes deep-review P0 #2. New `security-meta-check.yml` CI job that fails if `dependabot/alerts` returns 403. Adds CodeRabbit or equivalent PR-review bot (v4-integrated parity); falls back to a "code-reviewer agent" via the `Agent` tool if no commercial bot is selected.

Batch 0F (remove static-secret JWT fallback) also explicitly addresses deep-review P0 #7.

---

## 5. Synthesis-plan §5 Phase 1 — finance closeout, additive scope

Phase 1 absorbs deep-review **P1 #17** (optimistic locking on race-prone models) and **P1 #18** (AuditLog.userId FK to User). New canonical batches:

- **1H — Optimistic locking for race-prone models.** Add `version Int @default(1)` to `Mark`, `ModuleResult`, `Invoice`, `Payment`, `ExamBoardDecision`, `AssessmentAttempt`, `Enrolment`. Update repository update methods to require expected version, throw new `ConflictError` (→ 409) on mismatch, bump on success.
- **1I — AuditLog FK hardening.** Promote `AuditLog.userId` from free-text string to FK on `User` with `onDelete: Restrict`. Soft-deleted-user reference table retains the chain.

---

## 6. Synthesis-plan §5 Phase 3 — HESA / UKVI, additive scope

Phase 3 explicitly absorbs the `hesa-data-management` and `sjms-compliance-expert` skill packages as domain-lead briefing material. See [`docs/skills-leads/04-phase-3-hesa-ukvi-regulatory.md`](skills-leads/04-phase-3-hesa-ukvi-regulatory.md).

Additional Phase 3 batch:

- **3F — HESA snapshot immutability + notification table.** Imports the SJMS-2.5 patterns from migrations `20260408155000_hesa_snapshot_immutability` and `20260413210029_add_hesa_notification` (PostgreSQL trigger blocking UPDATE/DELETE on `hesa_snapshots`; `HesaNotification` table with status enum).

---

## 7. Synthesis-plan §5 Phase 9 — portal completion, additive scope

Phase 9 absorbs deep-review **P2 #23** (Playwright in CI). New canonical batch:

- **9F — Playwright golden-journey E2E in CI.** Dockerised stack runner; cover admissions → enrolment and enrolment → marks → progression journeys. Cap total job time at 15 minutes. Upload report on failure.

Phase 9 also absorbs deep-review **P3 #31** (bundle splitting) as part of existing batch 21C.

---

## 8. Synthesis-plan §5 Phase 10 — analytics, additive scope

Phase 10 absorbs deep-review **P2 #21** (OpenTelemetry tracing) and **P2 #22** (SLO definitions + alerting rules-as-code). New canonical batch:

- **10F — Observability completeness.** OTel tracing on server + client, exported to Tempo/Jaeger, correlated with existing request-id. SLO definitions in `docs/operations/slos.yaml`. Prometheus alert rules as code in `docker/prometheus/alerts/`.

---

## 9. Synthesis-plan §5 Phase 12 — pilot readiness, additive scope

Phase 12 absorbs deep-review **P2 #24** (MinIO presigned + virus scan + lifecycle), **P2 #26** (WCAG 2.2 a11y CI gate — was synthesis-plan WCAG 2.1; ratchet to 2.2), **P2 #27** (backup/restore drill), **P2 #28** (DPIA / ROPA / subject-rights workflow), **P2 #29** (SPDX license-policy gate), **P2 #30** (cosign image signing).

The `sjms-data-migration-lead` skill package is the domain-lead briefing for Phase 12. See [`docs/skills-leads/13-phase-12-pilot-readiness.md`](skills-leads/13-phase-12-pilot-readiness.md).

---

## 10. Review-prompt mapping (deep review §14 → SJMS-5 phases)

| Deep-review prompt | Title | Maps to SJMS-5 |
|---|---|---|
| **A** | Branch protection + bus-factor reduction | Phase 0 batch **0K** |
| **B** | Verify and surface Dependabot alerts | Phase 0 batch **0N** |
| **C** | Encrypt secrets at rest | Phase 0 batch **0C** (extends AES-256-GCM scope to `WebhookSubscription.secretKey` + `UserSession.sessionToken`) |
| **D** | Transactional outbox for events | Phase 0 batch **0L** ⭐ load-bearing |
| **E** | Pin `:latest` + SBOM + Trivy | Phase 0 batch **0M** |
| **F** | ESLint baseline triage + ratchet to blocking | Phase 3 closeout (operating-model item 6) |
| **G** | Coverage ratchet | Operating-model §9 (built-in) |
| **H** | MFA enforcement | Phase 0 batch **0G** ✓ |
| **I** | Optimistic locking on race-prone models | Phase 1 batch **1H** |
| **J** | Playwright in CI with Dockerised stack | Phase 9 batch **9F** |

---

## 11. Domain-lead briefs

Thirteen briefs (overview + 12 phase leads) live in [`docs/skills-leads/`](skills-leads/). Each brief is a self-contained subagent prompt covering: persona, mission, primary + supporting skills-library references, inputs, outputs, non-goals, verification protocol, and the relevant phase scope.

| Phase | Lead | Primary skill source |
|---|---|---|
| 0 | Spine Import Lead | `skills/herm/01-system-architect.md` + `skills/sjms-data-migration-lead/` |
| 1 | Finance Closeout Lead | `skills/student-finance/01-student-finance-product-owner.md` |
| 2 | Multi-Tenancy Architect | `skills/herm/01-system-architect.md` + `skills/curriculum-management/07-cms-domain-data-modeler.md` |
| 3 | HESA / UKVI / Regulatory Lead | `skills/hesa-data-management/` + `skills/sjms-compliance-expert/` |
| 4 | PGR Domain Lead | New persona (synthesised — UK HE PGR researcher / supervision lifecycle) |
| 5 | Apprenticeships Domain Lead | New persona (synthesised — ESFA / OTJ / EPA) |
| 6 | Recruitment & Enquiry CRM Lead | Derived from `skills/student-finance/01` + admissions content |
| 7 | Accommodation / VLE / AI Assistive Lead | `skills/student-journey/06-tutorials-attendance-engagement-product-owner.md` + new AI assistive persona |
| 8 | Integration Activation Lead | `skills/curriculum-management/08-integrations-publishing-engineer.md` + `skills/student-finance/08-erp-gl-integration-architect.md` |
| 9 | Portal Completion / Student Journey Lead | `skills/student-journey/01-e2e-student-journey-architect.md` |
| 10 | Analytics & BI Lead | `skills/curriculum-management/09-reporting-mi-designer.md` |
| 11 | AI-Native Architect | New persona (synthesised — AI governance + decision-support patterns) |
| 12 | Pilot Readiness Lead | `skills/sjms-data-migration-lead/` + `skills/student-finance/12-pci-payment-security-lead.md` |

---

## 12. Multi-agent invocation policy

Subagents are spawned per the patterns established in the operator conversation (2026-05-16):

1. **Not as default execution mode.** One phase = one branch = one PR. Mechanical implementation work runs single-agent.
2. **At three points per phase where parallelism genuinely buys time:**
   - **Phase opening:** the relevant domain lead drafts the batch breakdown (+ design doc if STOP-gated) in parallel with a compliance-review agent.
   - **Mid-phase parallel slices:** where two batches are genuinely independent, spawn implementer agents on stacked sub-branches.
   - **Phase closeout:** spawn a code-reviewer agent + a compliance-expert agent on the PR diff in parallel; their reports feed the closeout batch.
3. **Always brief from the relevant `docs/skills-leads/<NN>-phase-N-*.md` file**, not raw 54-role specs. The leads are pre-distilled to ~80 lines each.
4. **Always return summaries, never let agents push code directly to a phase branch.** The parent (Claude session driving the phase) integrates.

---

## 13. New operator approval for record

A seventh approval gate is added to the synthesis plan §11:

7. **Plan amendments approved** — Option 1 (refine before Phase 0). Transactional outbox absorbed into Phase 0 as load-bearing batch 0L. Domain-lead briefs become the operating handle for subagent invocation.

**Approved 2026-05-16.**

---

## 14. What does *not* change

- The 12-phase shape of the delivery plan stands.
- The six original operator-approval gates stand.
- Option B (clone-2.5-into-SJMS-5, layer v4 surface) stands.
- The SJMS-2.5 parallel-track decision stands (freeze at 18C; absorb 18D–F into SJMS-5 Phase 1).
- Operating model §1–§13 stands.
- AI-native architecture principles (§9 of synthesis plan) stand.
- Pilot readiness criteria (§10 of synthesis plan) stand.

---

*End of amendments. Next: Phase 0 batch 0A on branch `phase-0/spine-import`.*
