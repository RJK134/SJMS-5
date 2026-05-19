# Phase 1D — Refund approvals two-step workflow

> Closes Batch 1D per [`docs/SJMS-5-BUILD-QUEUE.md`](../../docs/SJMS-5-BUILD-QUEUE.md) Phase 1 §1D.
> Closes the refund leg of [`KI-S5-001`](../../docs/SJMS-5-KNOWN-ISSUES.md) (was KI-P10b-001).

## Scope

The pre-existing `refund-approvals` module shipped a flat CRUD surface where any FINANCE user could PATCH a refund row straight from `REQUESTED` to `PROCESSED` in one step. The Phase 1D batch in the build queue requires a **two-step REGISTRY → FINANCE** workflow with **segregation of duties** so a single user cannot both propose and approve a refund.

This batch wires:

- **REGISTRY proposes** via `POST /v1/refund-approvals` — the service forces `status=REQUESTED` regardless of payload to prevent status side-load.
- **FINANCE approves** via `POST /v1/refund-approvals/:id/approve` — `REQUESTED → APPROVED`, sets `approvedBy` + `approvedDate` server-side from the auth context. Blocks self-approval (proposer ≠ approver).
- **FINANCE rejects** via `POST /v1/refund-approvals/:id/reject` — `REQUESTED → REJECTED`, optional reason appended to the audit-visible `reason` text.
- **FINANCE processes** via `POST /v1/refund-approvals/:id/process` — `APPROVED → PROCESSED`, sets `processedDate`.
- **Generic PATCH** restricted to `SUPER_ADMIN` so a FINANCE user cannot back-door an approval by smuggling `status` through the metadata path.
- **Reads** open to both REGISTRY and FINANCE so registry users can see what they queued and finance users can see what is incoming.

State machine (validated in the service layer):

```
REQUESTED ──approve──▶ APPROVED ──process──▶ PROCESSED
    │
    └─── reject ──▶ REJECTED   (terminal)
```

Invalid transitions raise `ValidationError` (HTTP 400). Self-approval raises `ForbiddenError` (HTTP 403).

## Schema impact

**None.** The existing `RefundApproval` Prisma model already carries `status`, `approvedBy`, `approvedDate`, `processedDate`, `reason`, `createdBy`. No migration; no new fields.

## API surface delta

| Method | Path | Role gate | Notes |
|---|---|---|---|
| `GET` | `/v1/refund-approvals` | REGISTRY ∪ FINANCE | (was FINANCE only) |
| `GET` | `/v1/refund-approvals/:id` | REGISTRY ∪ FINANCE | (was FINANCE only) |
| `POST` | `/v1/refund-approvals` | REGISTRY | (was FINANCE) — proposers |
| `POST` | `/v1/refund-approvals/:id/approve` | FINANCE | **new** |
| `POST` | `/v1/refund-approvals/:id/reject` | FINANCE | **new** |
| `POST` | `/v1/refund-approvals/:id/process` | FINANCE | **new** |
| `PATCH` | `/v1/refund-approvals/:id` | SUPER_ADMIN | (was FINANCE) — clerical only |
| `DELETE` | `/v1/refund-approvals/:id` | SUPER_ADMIN | unchanged |

## Events

New semantic transition events alongside the existing `refund_approval.{created,updated,status_changed,deleted}` envelope:

- `refund_approval.proposed` — fired by `create()`; consumers wanting only the proposal step can now subscribe directly rather than pattern-matching on `status_changed`.
- `refund_approval.approved` — fired by `approve()`; carries `proposedBy` so downstream pipelines can chase up the original requester.
- `refund_approval.rejected` — fired by `reject()`; carries the rejection reason and rejector identity.
- `refund_approval.processed` — fired by `process()`; carries the processor identity and timestamp.

Webhook routes registered in `server/src/utils/webhooks.ts` (4 new entries).

## Files touched

| Type | Path |
|---|---|
| Service | `server/src/api/refund-approvals/refund-approvals.service.ts` |
| Controller | `server/src/api/refund-approvals/refund-approvals.controller.ts` |
| Router | `server/src/api/refund-approvals/refund-approvals.router.ts` |
| Schemas | `server/src/api/refund-approvals/refund-approvals.schema.ts` |
| Wiring | `server/src/utils/webhooks.ts` (+4 event routes) |
| Tests | `server/src/__tests__/unit/refund-approvals.service.test.ts` (+18 cases) |
| Evidence | `evidence/phase-1/1d-refund-approvals-two-step.md` (this file) |

## Verification

```
$ cd server && npx tsc --noEmit
exit 0

$ cd server && npx vitest run src/__tests__/unit/refund-approvals.service.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)

$ cd server && npx vitest run
 Test Files  1 failed | 46 passed (47)
      Tests  1 failed | 766 passed (767)
```

The one suite-wide failure is `cryptobox.test.ts > round-trips a 1MB payload` timing out at 5000 ms — a pre-existing slow-machine flake from PR #73 (Phase 0C). Unrelated to this batch; not introduced here.

## Acceptance criteria (Phase 1 §1D)

- [x] Refund proposal happens at REGISTRY role gate.
- [x] Approval happens at FINANCE role gate.
- [x] Self-approval blocked by service-layer SoD check (proposer ≠ approver).
- [x] Invalid state transitions raise `ValidationError` (400).
- [x] All transitions audit-logged via `logAudit('RefundApproval', ..., 'UPDATE', ...)`.
- [x] All transitions emit canonical webhook events.
- [x] Generic PATCH back-door closed (SUPER_ADMIN only).
- [x] British English throughout.
- [x] Server `tsc --noEmit` clean.
- [x] 23 unit tests cover happy paths + every rejection path.

## Out of scope (deferred)

- **Frontend.** Endpoints API-testable via curl / Postman now; staff-portal refund queue UI lands in **Batch 1F** (finance dashboards).
- **Refund ↔ Payment reconciliation.** Once `PROCESSED`, the financial accounting hand-off to the payment pipeline is sequenced to **Batch 1E** (ledger anomaly + reconciliation surface).
- **Optimistic locking on `RefundApproval`.** Not in the Phase 1H model list (Mark, ModuleResult, Invoice, Payment, ExamBoardDecision, AssessmentAttempt, Enrolment). If pilot ops surface refund race conditions, fold into a 1H follow-up.
- **Notification on approval/rejection.** The events emit; wiring an actual student email goes through Phase 0L outbox + Phase 8 n8n templates.

## Known issues

None introduced.
