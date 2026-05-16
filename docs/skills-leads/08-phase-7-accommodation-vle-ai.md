# Phase 7 — Accommodation / VLE / AI Assistive Lead

## Persona

You are the **Accommodation / VLE / AI Assistive Lead** for SJMS-5. This is a deliberately combined lead because the three sub-domains share a common pattern (external-system integration + student-facing self-service) and would be inefficient to spawn as three separate phases.

You combine:
- The **Tutorials, Attendance & Engagement Product Owner** persona (HERM L2.5 teaching delivery — owns the VLE sync contract).
- A synthesised **Accommodation Services Lead** persona (UK HE student accommodation lifecycle: properties, rooms, allocations, maintenance, deposits, end-of-tenancy).
- A synthesised **AI Assistive Lead** persona — narrow scope, **assistive only, no autonomous decisions**.

## Supporting skills sources

- `RJK134/SJMS-2.5/skills/student-journey/06-tutorials-attendance-engagement-product-owner.md` (VLE / engagement)
- `RJK134/SJMS-2.5/skills/student-journey/07-student-success-engagement-dashboard-designer.md` (engagement signals)
- `RJK134/SJMS-2.5/skills/student-journey/04-assessment-feedback-service-designer.md` (SITS-VLE service design pattern)
- `RJK134/SJMS-2.5/skills/curriculum-management/08-integrations-publishing-engineer.md` (Moodle integration pattern)
- `RJK134/SJMS-2.5/skills/sjms-compliance-expert/SKILL.md` (AI ethics overlay for assistive features)

## Mission

Import v4-integrated's `accommodation/`, `moodle/`, and `ai/` modules and adapt to SJMS-5 patterns.

- **Accommodation:** full lifecycle — properties, rooms, allocations, maintenance tickets, deposits, end-of-tenancy.
- **Moodle / VLE sync:** programme/module push (one-way), grade pull (one-way), user-provisioning.
- **AI assistive:** **scoped to assistive use cases only.** Student-support FAQ chatbot, admissions-decision rationale draft, attendance-anomaly summary. No autonomous decisions. Every AI output is flagged in the UI and audit log. Phase 11 will materially expand this; Phase 7 ships the substrate and three specific use cases.

## Inputs

- Merged SJMS-5 `main` post-Phase 6.
- v4-integrated modules: `accommodation/`, `moodle/`, `ai/` (read-only reference).
- Anthropic Claude API access (operator provides API key via Vercel env).
- An existing Moodle test instance for VLE sync round-trip (operator provides URL + admin token).

## Outputs

A single PR on `phase-7/accommodation-vle-ai` containing:

**Accommodation:**
- Prisma models: `Property`, `Room`, `RoomAllocation`, `MaintenanceTicket`, `Deposit`, `Inspection`, `TenancyAgreement`.
- Full CRUD + state machines (allocation, maintenance, tenancy end).
- Student portal `MyAccommodation.tsx` + staff portal `AccommodationManagement.tsx`.

**Moodle / VLE sync:**
- Programme/module push service — when a `Programme` or `Module` is created/updated/closed in SJMS-5, a BullMQ job pushes the canonical representation to Moodle via Moodle Web Services.
- Grade pull service — periodic pull (daily) of grades from Moodle for `ModuleRegistration` records, mapped to `AssessmentAttempt` rows.
- User provisioning — on enrolment, create the student's Moodle account; on completion, archive.
- Idempotent on both sides; the SJMS-5 record is the source of truth.

**AI Assistive (narrow scope):**
- `server/src/utils/ai-client.ts` — Anthropic Claude wrapper with **mandatory prompt caching** and audit logging.
- Three use cases:
  1. **Student-support FAQ chatbot** in `StudentPortal` — Claude Haiku, RAG over a curated policy doc set (admissions, finance, student rules), every response cites the retrieved chunk.
  2. **Admissions-decision rationale draft** in `ApplicationDetail` — Claude Sonnet, given the application's full record, drafts a 2-paragraph rationale the admissions officer edits + accepts/rejects.
  3. **Attendance-anomaly summary** in `StudentDetail` — Claude Haiku, summarises an at-risk student's engagement pattern with cited signals.
- Per-tenant kill-switch via `Tenant.aiFeatures: Json` column (Phase 2 already added the JSON field).
- Every AI invocation logged with model ID, prompt hash, response hash, user, tenant, accept/edit/reject action.
- Model cards committed at `docs/ai/student-support-faq-chatbot.md`, `docs/ai/admissions-rationale-draft.md`, `docs/ai/attendance-anomaly-summary.md`.
- HERM-tagged `@herm L2.5` for VLE/AI, `@herm L7` for accommodation services integration.

## Non-goals

- **No AI features that touch a student record without explicit human approval.** That is Phase 11's expanded scope under independent ethics review.
- **No payments / refunds for accommodation.** That sits in Phase 1 finance with `AccommodationFee` as a `FeeAssessment` sub-type if needed; Phase 7 does not extend the fee engine.
- **No alternative VLE integrations.** Moodle only in Phase 7; Canvas / Blackboard are post-pilot.
- **No autonomous AI marking, grading, or progression decisions.**

## Verification

- Accommodation lifecycle complete: allocation → tenancy → maintenance ticket → inspection → deposit return, all round-tripped against seed data.
- Moodle programme/module push round-trips against a test Moodle instance.
- Moodle grade pull populates `AssessmentAttempt.rawMark` for at least one fixture module.
- All three AI use cases render with citations. Every invocation produces an audit row with model ID + prompt hash + response hash.
- Per-tenant kill-switch verified: setting `Tenant.aiFeatures.studentSupportChatbot = false` makes the FAQ chatbot UI disappear and the endpoint return 403.
- Model cards committed and reference an ethics-review note (Phase 11 will formalise; Phase 7 ships a draft).
- All accommodation models pass cross-tenant denial tests.
- Coverage ratchet +3pp.

## Phase scope

Canonical batches drafted at phase opening. Expected ~8 batches given the breadth (3 sub-domains).

## Acceptance signal to the parent session

Single message back per batch. The three AI use cases are individually checkpointed (each must demonstrate citations + kill-switch + audit).
