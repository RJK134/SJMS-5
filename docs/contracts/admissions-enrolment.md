# Contract — Admissions → Offer → Enrolment

> **Status:** GREEN (rules implemented at the service boundary; this document is descriptive, not prescriptive)
> **Source files:** `server/src/api/applications/applications.service.ts`, `server/src/api/offers/offers.service.ts`, `server/src/api/enrolments/enrolments.service.ts`, `server/src/utils/webhooks.ts`
> **Tests:** `server/src/__tests__/unit/admissions.service.test.ts`, `offers.service.test.ts`, `enrolments.service.test.ts`, `clearance-checks.service.test.ts`
> **Scope:** Phase 16 golden journey, Batches 16A–16D
> **Last updated:** 2026-04-29

This document is the canonical decision-table reference for the
Admissions → Offer → Enrolment journey. Every rule in this file is
already enforced in the service layer; the document codifies the rules
in one place so that reviewers, BugBot, and future Claude sessions can
verify behaviour without reading three separate service files.

---

## 1. Application status — allowed transitions

The map below is the canonical lifecycle. Any hop not listed is rejected
at the service boundary by `assertValidApplicationTransition` with
`ValidationError`. Same-state writes (`SUBMITTED → SUBMITTED`) are
allowed as no-ops to make idempotent retries safe.

| From state            | Allowed next states                                                                    | Notes                                                                       |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `SUBMITTED`           | `UNDER_REVIEW`, `WITHDRAWN`, `REJECTED`                                                | Initial state; cannot skip directly to an offer                              |
| `UNDER_REVIEW`        | `INTERVIEW`, `CONDITIONAL_OFFER`, `UNCONDITIONAL_OFFER`, `REJECTED`, `WITHDRAWN`        |                                                                             |
| `INTERVIEW`           | `CONDITIONAL_OFFER`, `UNCONDITIONAL_OFFER`, `REJECTED`, `WITHDRAWN`                     | Cannot fall back to `UNDER_REVIEW`                                          |
| `CONDITIONAL_OFFER`   | `UNCONDITIONAL_OFFER`, `FIRM`, `INSURANCE`, `DECLINED`, `WITHDRAWN`                     | Auto-promotion to `UNCONDITIONAL_OFFER` driven by offer-condition evaluator |
| `UNCONDITIONAL_OFFER` | `FIRM`, `INSURANCE`, `DECLINED`, `WITHDRAWN`                                            |                                                                             |
| `FIRM`                | `WITHDRAWN`                                                                            | Conversion to Student is a separate operation, not a status change          |
| `INSURANCE`           | `FIRM`, `WITHDRAWN`                                                                    | `INSURANCE → FIRM` covers results-day insurance promotion                   |
| `DECLINED`            | (terminal)                                                                             |                                                                             |
| `WITHDRAWN`           | (terminal)                                                                             |                                                                             |
| `REJECTED`            | (terminal)                                                                             |                                                                             |

### 1.1 Decision-stamp rules

Transitions to `CONDITIONAL_OFFER`, `UNCONDITIONAL_OFFER`, or `REJECTED`
are institutional decisions. The service auto-stamps `decisionDate` and
`decisionBy` on those transitions unless the caller supplies the values
explicitly. Applicant-driven transitions (`FIRM`, `INSURANCE`,
`DECLINED`, `WITHDRAWN`) do **not** stamp decision fields.

### 1.2 Required events on every update

| Trigger                              | Event name                          | Always fired? |
| ------------------------------------ | ----------------------------------- | ------------- |
| Any successful `update()`            | `application.updated`               | yes           |
| Any successful status change         | `application.status_changed`        | yes           |
| Auto-promotion via condition evaluator | `application.offer_conditions_met` | yes (in addition to `status_changed`) |
| `convertToStudent()` success         | `application.converted`             | yes           |
| `students.create()` during conversion | `students.created`                 | only when a new Student is created |
| `enrolments.create()` during conversion | `enrolment.created`              | only when a new Enrolment is created |

---

## 2. Offer-condition lifecycle

Offer conditions are stored as `OfferCondition` rows linked to an
`Application`. Each row carries one of four statuses:

| Status    | Meaning                                                | Counts as satisfied? |
| --------- | ------------------------------------------------------ | -------------------- |
| `PENDING` | Awaiting evidence                                      | no                   |
| `MET`     | Evidence received and accepted                         | yes                  |
| `NOT_MET` | Evidence received and rejected                         | no                   |
| `WAIVED`  | Formally discounted by an admissions decision          | yes                  |

### 2.1 Auto-promotion rules

`evaluateOfferConditionsAndAutoPromote(applicationId, actorId, req)`
runs after every offer-condition mutation. It promotes the parent
application from `CONDITIONAL_OFFER` to `UNCONDITIONAL_OFFER` if and
only if **all** of the following hold:

1. The application is currently in `CONDITIONAL_OFFER`.
2. The application has at least one **non-deleted** `OfferCondition`.
3. Every non-deleted condition has a status in `{MET, WAIVED}`.

Soft-deleted conditions (`deletedAt != null`) are excluded from the
calculation, so removing the only blocking condition triggers
promotion.

The promotion is routed through the application's normal `update()`
path, so the lifecycle guard, audit log, and `application.updated` /
`application.status_changed` / `application.offer_conditions_met`
events all fire through their usual channels.

### 2.2 Idempotency

A second call to the evaluator after a successful promotion is a no-op
because the application is no longer in `CONDITIONAL_OFFER`. The
evaluator returns `null` in that case rather than throwing.

### 2.3 Fail-soft wrapper

The offers service wraps every evaluator call in
`safeEvaluateOfferConditions()`, which logs and swallows any error so
that the underlying offer-condition mutation (which has already been
committed) is not rolled back. This mirrors the attendance-threshold
backstop pattern and ensures the HTTP client never sees a 5xx error
from a downstream auto-promotion failure that has nothing to do with
the original mutation.

---

## 3. Conversion eligibility — Application → Student → Enrolment

`POST /v1/applications/:id/convert` (handler:
`applications.controller.ts::convert`, service:
`applicationsService.convertToStudent`).

### 3.1 Eligibility matrix

| Application status     | Convertible? | Notes                                                                |
| ---------------------- | ------------ | -------------------------------------------------------------------- |
| `SUBMITTED`            | no           |                                                                      |
| `UNDER_REVIEW`         | no           |                                                                      |
| `INTERVIEW`            | no           |                                                                      |
| `CONDITIONAL_OFFER`    | no           | Conditions must be evidenced first (or auto-promoted)                |
| `UNCONDITIONAL_OFFER`  | **yes**      | Direct-entry / clearing path                                         |
| `FIRM`                 | **yes**      | Primary path                                                         |
| `INSURANCE`            | no           | Applicant has not yet committed                                      |
| `DECLINED`             | no           |                                                                      |
| `WITHDRAWN`            | no           |                                                                      |
| `REJECTED`             | no           |                                                                      |

Calls against an ineligible status throw `ValidationError` with
`{status: ['Cannot convert an application with status <status>']}`.

### 3.2 Required input

```ts
interface ConversionInput {
  yearOfStudy?: number;     // defaults to 1
  modeOfStudy: string;      // required
  startDate: Date;          // required
  feeStatus: string;        // required
  originalEntryDate?: Date; // defaults to startDate
}
```

### 3.3 Idempotency contract

The endpoint is safe to retry. The service:

1. Looks up the `Person` linked to the `Application.applicant`.
   - 404 if no applicant or no person link exists.
2. Looks up an existing `Student` by `personId`.
   - If found, reuses it; `isNewStudent = false`.
   - If not found, generates a candidate student number and creates
     one via `studentsService.create()`; `isNewStudent = true`.
3. Looks up an existing `Enrolment` by
   `(studentId, programmeId, academicYear)` (the `findForJourney`
   helper).
   - If found, reuses it; `isNewEnrolment = false`.
   - If not found, creates one via `enrolmentsService.create()`;
     `isNewEnrolment = true`.
4. Writes the audit log and emits `application.converted` once,
   regardless of whether the Student or Enrolment were newly created
   or reused.

A second call therefore returns the same `studentId`,
`studentNumber`, and `enrolmentId` with `isNewStudent = false` and
`isNewEnrolment = false`. The controller currently responds with
**201 Created** on every successful call (including idempotent replays);
clients should treat the combination of flags and stable IDs as the
idempotency signal, not the status code.

### 3.4 Application-route → Entry-route mapping

`Student.entryRoute` is derived from `Application.applicationRoute`
(applications track how they arrived; students track how they
entered). Unmapped routes default to `DIRECT`.

| ApplicationRoute  | EntryRoute      |
| ----------------- | --------------- |
| `UCAS`            | `UCAS`          |
| `DIRECT`          | `DIRECT`        |
| `CLEARING`        | `CLEARING`      |
| `INTERNATIONAL`   | `INTERNATIONAL` |
| (anything else)   | `DIRECT`        |

---

## 4. Required audit events and webhook contract

Every mutation in the journey writes an `AuditLog` row via
`logAudit(entityType, entityId, action, userId, before, after, req)`
and emits a canonical `WebhookPayload` via `emitEvent(payload)`.

### 4.1 Canonical payload shape

```ts
interface WebhookPayload {
  event: string;             // e.g. "application.converted"
  entityType: string;        // Prisma model name, e.g. "Application"
  entityId: string;          // primary key of the affected entity
  actorId: string;           // Keycloak sub claim of the actor
  timestamp?: string;        // ISO 8601 UTC; auto-filled
  requestId?: string;        // x-request-id correlation; auto-filled
  data: Record<string, unknown>; // domain-specific shape — never the full Prisma object
}
```

### 4.2 Events and webhook paths (admissions journey)

Resolved by `EVENT_ROUTES` in `server/src/utils/webhooks.ts`.

| Event                                  | Webhook path                                          | Source                                                                       |
| -------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `application.created`                  | `/webhook/sjms/application/created`                   | `applications.service.create()`                                              |
| `application.updated`                  | `/webhook/sjms/application/updated`                   | `applications.service.update()`                                              |
| `application.status_changed`           | `/webhook/sjms/application/status-changed`            | `applications.service.update()` (only when status differs)                   |
| `application.offer_conditions_met`     | `/webhook/sjms/application/offer-conditions-met`      | `applications.service.evaluateOfferConditionsAndAutoPromote()`               |
| `application.converted`                | `/webhook/sjms/application/converted`                 | `applications.service.convertToStudent()`                                    |
| `application.deleted`                  | `/webhook/sjms/application/deleted`                   | `applications.service.remove()`                                              |
| `offer_condition.created`              | `/webhook/sjms/offer-condition` (prefix fallback)     | `offers.service.create()`                                                    |
| `offer_condition.updated`              | `/webhook/sjms/offer-condition` (prefix fallback)     | `offers.service.update()`                                                    |
| `offer_condition.status_changed`       | `/webhook/sjms/offer-condition` (prefix fallback)     | `offers.service.update()` (only when status differs)                         |
| `offer_condition.deleted`              | `/webhook/sjms/offer-condition` (prefix fallback)     | `offers.service.remove()`                                                    |
| `students.created`                     | `/webhook/sjms/student/created`                       | `students.service.create()` — fires on conversion when a new Student is created |
| `enrolment.created`                    | `/webhook/sjms/enrolment/created`                     | `enrolments.service.create()` — fires on conversion when a new Enrolment is created |
| `enrolment.updated`                    | `/webhook/sjms/enrolment/updated`                     | `enrolments.service.update()`                                                |
| `enrolment.status_changed`             | `/webhook/sjms/enrolment/status-changed`              | `enrolments.service.update()` (only when status differs)                     |

### 4.3 Required `data` shapes

```ts
// application.updated / application.status_changed
data: {
  applicantId: string;
  programmeId: string;
  academicYear: string;
  previousStatus?: string; // status_changed only
  newStatus?: string;      // status_changed only
}

// application.offer_conditions_met
data: {
  applicantId: string;
  programmeId: string;
  promotedFrom: 'CONDITIONAL_OFFER';
  promotedTo: 'UNCONDITIONAL_OFFER';
  conditionIds: string[];   // every non-deleted satisfied condition
}

// application.converted
data: {
  applicationId: string;
  applicantId: string;
  programmeId: string;
  academicYear: string;
  studentId: string;
  studentNumber: string;
  enrolmentId: string;
  isNewStudent: boolean;
  isNewEnrolment: boolean;
}

// offer_condition.* — common
data: {
  applicationId: string;
  conditionType: string;
  description?: string;
  status?: string;            // not on .deleted
  previousStatus?: string;    // status_changed only
  newStatus?: string;         // status_changed only
}
```

### 4.4 Audit log shape

`AuditLog` rows are written for every mutation with the standard
`(entityType, entityId, action, userId, before, after, requestId)`
shape. `before` is null on `CREATE`, the prior row on `UPDATE`, and
the row prior to soft-delete on `DELETE`. `after` is the new row on
`CREATE` / `UPDATE`, and null on `DELETE`. The conversion path writes
a single `Application` audit row whose `after` is the same shape as
`before` plus `convertedStudentId` and `convertedEnrolmentId`.

---

## 5. Validation contract

Admissions-journey routes attach Zod-backed `validate` /
`validateParams` / `validateQuery` middleware **before** the
controller. In the Express routers, that validation runs **before**
`requireRole(...)` on mutating routes (see `applications.router.ts`,
`offers.router.ts`, `enrolments.router.ts`). Schemas live in
`applications.schema.ts`, `offers.schema.ts`, and
`enrolments.schema.ts`. The schemas enforce:

- `status` must be in the canonical enum on both create and update
  paths.
- `convertSchema` accepts `{ yearOfStudy?, modeOfStudy, startDate,
  feeStatus, originalEntryDate? }`.
- Numeric fields (`yearOfStudy`) are bounded.
- ISO date fields are coerced from string.
- Unknown fields are stripped (`.strict()` is intentionally **not**
  used — we want forward-compatibility with downstream additions).

The service layer never trusts callers to supply a valid transition;
the service-side guard runs after Zod validation as a defence in
depth.

---

## 6. RBAC contract

Role checks use `requireRole(...ROLE_GROUPS.*)` from
`applications.router.ts`, `offers.router.ts`, and
`enrolments.router.ts`. Users with Keycloak role `super_admin` bypass
all `requireRole` checks (`server/src/middleware/auth.ts`). The table
below reflects those routers as of the Phase 16 merge (expand
`ROLE_GROUPS` in `server/src/constants/roles.ts` for the full role
list).

| Route                                           | `ROLE_GROUPS` / access pattern                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /v1/applications`                          | `ALL_AUTHENTICATED` + `scopeToUser('personId')` (applicant-scoped list)                        |
| `GET /v1/applications/:id`                      | `ADMISSIONS`                                                                                   |
| `POST /v1/applications`                         | `ADMISSIONS`                                                                                   |
| `PATCH /v1/applications/:id`                    | `ADMISSIONS`                                                                                   |
| `DELETE /v1/applications/:id`                   | `SUPER_ADMIN`                                                                                  |
| `POST /v1/applications/:id/convert`             | `REGISTRY` only (registrar, senior registry officer, registry officer)                         |
| `GET /v1/offers`, `GET /v1/offers/:id`          | `ADMISSIONS`                                                                                   |
| `POST /v1/offers`, `PATCH /v1/offers/:id`       | `ADMISSIONS`                                                                                   |
| `DELETE /v1/offers/:id`                         | `SUPER_ADMIN`                                                                                  |
| `GET /v1/enrolments`                            | `ALL_AUTHENTICATED` + `scopeToUser('studentId')`                                               |
| `GET /v1/enrolments/:id`                        | `ALL_AUTHENTICATED` + `requireOwnership`                                                       |
| `POST /v1/enrolments`                           | `REGISTRY`                                                                                     |
| `PATCH /v1/enrolments/:id`                      | `REGISTRY`                                                                                     |
| `DELETE /v1/enrolments/:id`                     | `SUPER_ADMIN`                                                                                  |

The router files remain the source of truth if guards change in a
later batch.

---

## 7. Tests that prove this contract

| File                                                                  | What it proves                                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `server/src/__tests__/unit/admissions.service.test.ts`                | Lifecycle transitions, decision-stamp rules, condition-evaluator promotion, idempotency, terminal-state guards  |
| `server/src/__tests__/unit/offers.service.test.ts`                    | Offer-condition CRUD, evaluator invocation on every mutation, status-change event emission                      |
| `server/src/__tests__/unit/enrolments.service.test.ts`                | Cascade rules to module-registrations, status-change events, lifecycle guards                                   |
| `server/src/__tests__/unit/clearance-checks.service.test.ts`          | Audit + event emission for the only previously-untested admissions-domain service                               |

A new test file named `applications.service.test.ts` is **not** present
because all of `applications.service.ts` is exercised through the
`admissions.service.test.ts` file, which mocks the repository layer.

---

## 8. What is *not* in this contract

- Frontend convert-to-student affordance — sequenced to **Batch 16E**.
  The endpoint exists; Registry currently drives it via the API.
- Finance handoff (`enrolment.created` → automatic `FeeAssessment`
  generation) — sequenced to **Phase 18A**.
- Multi-application "duplicate person" detection beyond the
  per-`personId` Student lookup — sequenced to Phase 19/21 once
  HESA returns are wired.
- Programme capacity / cohort-cap enforcement on conversion — Registry
  performs this manually today; sequenced to **Phase 17/18**.
