# SJMS-5 — Enterprise Synthesis

**Future Horizons Education** · UK Higher Education Student Journey Management System (v5)

> **Status: planning.** No code has been committed yet. This repository
> currently holds the founding planning artefacts only. The first executable
> phase is **Phase 0 — Spine Import**, which clones the verified SJMS-2.5
> substrate into this repo as the starting point. Nothing in `docs/` is a
> capability claim; everything is a target.

---

## Why SJMS-5 exists

Future Horizons Education has two parallel SJMS builds:

- **SJMS-2.5** (`rjk134/sjms-2.5`) — the **stronger engineering substrate**.
  Clean domain decomposition (44 flat routers + 9 group barrels, 196 Prisma
  models, 7 migrations), enterprise auth (Keycloak 24 OIDC, JWKS caching,
  dev-bypass hard-gated, internal-service-key with timing-safe compare),
  structured observability (Winston JSON + AsyncLocalStorage request-ID,
  Prometheus `/metrics`, OpenAPI from Zod), security posture (Helmet,
  Redis-backed rate limiting, CodeQL `security-extended`, CODEOWNERS,
  SECURITY.md), and a `docs:check` truth-pinning script that enforces
  documentation against repo state. Phase 17 (Assessment → Progression →
  Award) is **complete**. Phase 18 (Finance Readiness) is **in flight**
  (18A merged; 18B/18C done on branches; 18D–F outstanding).

- **SJMS v4-integrated** (`rjk134/sjms-v4-integrated`) — the **stronger
  product surface**. Five portals (Applicant, Student, Academic, Staff,
  Enrol Online), 42 API modules / ~78 routers covering AI, recruitment
  CRM, apprenticeships, PGR, accommodation, Moodle/VLE sync, regulatory
  (OfS/TEF), and HESA artefacts that 2.5 would take many phases to
  recreate (HUSID generator, HESA XML generator, HESES calculator,
  classification calculator). BullMQ + Redis + MinIO are **already wired**.
  AES-256-GCM field encryption is present. 62 n8n workflow templates
  with two-way PowerShell sync. k6 load scenarios. The trade-off is
  fragility: live build pages throw on seeded data, observability is
  lighter, multi-tenancy is asserted but only partial, SAML is claimed
  but unverified.

Neither is yet Tribal SITS / Ellucian Banner-grade. **Combined, they
exceed any single mid-tier UK HE SaaS challenger** (UNIT-e, Akari,
Quercus) and approach Banner/SITS modular parity for the domains they
cover. SJMS-5 is the convergence repo.

---

## Approvals on record (operator sign-off, 2026-05-16)

1. **Option B approved** — clone SJMS-2.5 into SJMS-5, layer v4 surface.
2. **Phase 0 mechanical import approved** — SJMS-2.5 `main` is the import baseline.
3. **SJMS-2.5 parallel-track decision approved** — SJMS-2.5 frozen at 18C; 18D–F absorbed into SJMS-5 Phase 1 (recommended variant).
4. **Multi-tenancy STOP-gate at Phase 2 approved** — design doc precondition.
5. **AI-native STOP-gate at Phase 11 approved** — independent ethics review precondition.
6. **SAML deferral to Phase 12 approved** — OIDC parity verified first.

---

## Reading order

1. **[`docs/SJMS-5-SYNTHESIS-PLAN.md`](docs/SJMS-5-SYNTHESIS-PLAN.md)** —
   the master plan. Read this first. Covers the verdict, the target
   architecture, the data-model convergence strategy, the phased delivery
   plan, and the AI-native extensions.
2. **[`docs/SJMS-5-BUILD-QUEUE.md`](docs/SJMS-5-BUILD-QUEUE.md)** — the
   phased queue with explicit acceptance criteria per phase. Mirrors the
   SJMS-2.5 BUILD-QUEUE.md governance pattern.
3. **[`docs/SJMS-5-OPERATING-MODEL.md`](docs/SJMS-5-OPERATING-MODEL.md)** —
   inherited from SJMS-2.5: one phase branch at a time from `main`, 3–8
   reviewable batches per phase, `report_progress` discipline, verification
   protocol, BugBot loop, PR convention. STOP-gates for architecturally
   significant changes.
4. **[`docs/SJMS-5-KNOWN-ISSUES.md`](docs/SJMS-5-KNOWN-ISSUES.md)** —
   carried-over and net-new known issues, with target phase resolution.

---

## At a glance

| Dimension                                  | SJMS-2.5 | v4-integrated | SJMS-5 target |
|-------------------------------------------|---------:|--------------:|--------------:|
| HERM v3.1 capability coverage (1–10)      |      5.6 |           6.3 |       8.0–8.5 |
| Architecture cleanliness & layering       |        8 |             6 |             9 |
| Observability                              |        8 |             5 |             9 |
| Security posture                           |        7 |             7 |             9 |
| External integrations (UCAS/SLC/HESA/VLE) |        5 |             7 |             9 |
| Multi-tenancy substrate                    |        2 |             6 |             9 |
| Portal experience & UX richness            |        5 |             8 |             9 |
| AI-native primitives                       |        2 |             4 |             8 |
| Pilot readiness vs Tribal SITS / Banner   |      5.8 |           6.4 |       8.0–8.5 |

*Scoring scale: 10 = Tribal SITS / Banner / Workday Student production-grade;
7 = strong UK HE SaaS challenger; 5 = credible mid-tier; 3 = working MVP.*

---

## Licence

Proprietary — Future Horizons Education. All rights reserved.
