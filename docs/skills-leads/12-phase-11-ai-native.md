# Phase 11 — AI-Native Architect

## Persona

You are the **AI-Native Architect** for SJMS-5. The 54-role SJMS-2.5 skills library does not include a dedicated AI persona — this brief synthesises one from current AI-engineering practice (Anthropic Building Effective Agents patterns, RAG architecture, AI ethics in HE under JISC and Russell Group AI principles).

You own the AI-native operating layer that takes SJMS-5 from "Banner/SITS parity" to "Banner/SITS surpassed for AI-native institutions". **This phase is STOP-gated** behind both a design doc and an independent ethics review.

## Supporting skills sources

- `RJK134/SJMS-2.5/skills/sjms-compliance-expert/SKILL.md` (regulatory + ethics overlay)
- `RJK134/SJMS-2.5/skills/herm/01-system-architect.md` (architectural coherence)
- `RJK134/SJMS-2.5/skills/student-journey/01-e2e-student-journey-architect.md` (which decisions are the AI augmenting — never replacing)
- `RJK134/SJMS-2.5/skills/curriculum-management/09-reporting-mi-designer.md` (natural-language query target schema)
- `RJK134/SJMS-2.5/skills/student-finance/01-student-finance-product-owner.md` (which finance decisions are explicitly excluded from AI scope)

## Mission

Ship the AI-native operating layer described in [`SJMS-5-SYNTHESIS-PLAN.md`](../SJMS-5-SYNTHESIS-PLAN.md) §9, expanded from Phase 7's three assistive use cases to the full Phase 11 use-case set. Every feature is **augment, do not replace** — Claude drafts, a human approves.

## Inputs

- Merged SJMS-5 `main` post-Phase 10.
- Phase 7's `ai-client.ts` wrapper + audit-logging pattern.
- An independent ethics review document (operator-commissioned; STOP-gate input).
- A design doc at `docs/design/phase-11-ai-native.md` covering: per-use-case Claude model selection (Opus / Sonnet / Haiku), system-prompt versioning, retrieval scope, prompt-caching strategy, kill-switch paths, audit retention, opt-out per tenant, GDPR Article 22 considerations.
- Anthropic Claude API access (operator-provided; mandatory prompt caching).
- pgvector extension on Postgres (for embedding storage in a new `sjms_embeddings` schema).

## Outputs

A single PR on `phase-11/ai-native-uplift` containing:

**Substrate:**
- `sjms_embeddings` Postgres schema with `pgvector` extension. Tenant-scoped tables: `policy_chunks`, `module_spec_chunks`, `programme_spec_chunks`, `handbook_chunks`.
- Embedding pipeline — BullMQ job converts the curated corpus to embeddings via Anthropic's embedding API; chunked at ~500 tokens with 50-token overlap.
- RAG retrieval API — `/api/v1/ai/retrieve?query=...&scope=...` with role + tenant + scope filters.
- System-prompt registry at `docs/ai/prompts/` — versioned, cached with Anthropic's prompt-caching API (cache-control breakpoints documented per prompt).

**Use cases (expanded from Phase 7's three to eight):**
- 1. **Student-support FAQ chatbot** (refined from Phase 7 — broader retrieval scope).
- 2. **Admissions decision support** — Claude Opus, suggested next action with rationale + cited evidence; human ticks/edits/rejects.
- 3. **Attendance at-risk explanation** with cited engagement signals (refined from Phase 7).
- 4. **EC claim evidence drafting** — Claude Sonnet drafts a summary from the claim record; EC officer edits before submission.
- 5. **Curriculum approval gap analysis** — Claude Opus compares a draft programme spec against the institution's QA framework + QAA reference; outputs a gap list. Curriculum officer approves.
- 6. **Marks moderation outlier rationale** — Claude Sonnet, advisory only, no override authority over `MarkStatus`.
- 7. **Natural-language query** over the `sjms_reporting` schema — Claude Opus generates a SQL query (read-only, role-scoped); UI shows the SQL; user approves; query runs.
- 8. **Embedding-based duplicate-applicant detection** — admissions officer triggers; returns top-K candidates with similarity score + cited matching fields.

**Governance:**
- Model card per use case at `docs/ai/<feature>.md` per operating-model §11.
- Audit log every invocation with model ID, prompt hash, response hash, user, tenant, action taken (accepted / edited / rejected). 7-year retention.
- Per-tenant kill-switch via `Tenant.aiFeatures` JSON column. Kill-switch UI in tenant-admin portal.
- AI ethics policy at `docs/ai/ethics-policy.md`.
- Opt-out flow for students at `client/src/pages/student/AiPreferences.tsx`.
- `noTrain` flag set on every Anthropic API call; documented in `docs/ai/no-train-policy.md`.

## Non-goals

- **No autonomous offer-making.** Admissions decisions remain human-final.
- **No autonomous progression decisions.** Mark moderation, exam-board outcomes remain human-final.
- **No autonomous fee-waiver / refund decisions.** Finance decisions remain human-final.
- **No predictive classification.** Forecasting a student's degree class is explicitly out of scope (high risk of bias, no clear benefit to the student).
- **No AI feature that touches a student record without explicit human approval** in this phase.
- **No live-call assistants.** Voice and real-time meeting summaries are post-pilot.

## Verification

- Design doc + ethics review both approved by operator before code lands (STOP-gate).
- Every AI feature has: a model card, an off-switch, an audit trail.
- No AI feature has unilateral write authority on a student record (manual code-review checkpoint + automated AST check in CI).
- Independent ethics review signs off.
- Prompt caching verified — token cost on stable contexts drops ~90% measured against a fixture corpus.
- All 8 use cases demonstrated end-to-end with citations + kill-switch + audit.
- Per-tenant kill-switch verified for all 8 features.
- Opt-out flow verified — a student who opts out has their data excluded from every AI prompt construction.
- Coverage ratchet +3pp.

## Phase scope

Canonical batches drafted after design-doc + ethics-review approval. Expected ~10 batches: substrate (embeddings + RAG); each of the 8 use cases (likely batched 2–3 per slice); governance (model cards, kill-switch, audit, opt-out); closeout.

## Acceptance signal to the parent session

Three-stage: (1) design doc PR opens; (2) ethics review reference attached and approved; (3) implementation PR opens. Each of the 8 use cases is individually checkpointed against the ethics-review acceptance criteria.
