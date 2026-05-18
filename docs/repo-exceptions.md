# Repository-pattern exceptions

> **Status at 2026-04-29:** GREEN — no architectural exceptions are currently active.

The SJMS 2.5 design rule is that every API service routes persistence
through a repository under `server/src/repositories/*` and only imports
`@prisma/client` for **type-only** purposes (`import type { Prisma }`).

A repo-wide scan run on 2026-04-29 (results in `docs/repo-scan.json`)
found **zero** runtime imports of the prisma client and **zero**
calls to `prisma.<model>.<method>` from API service code. The two
remaining grep matches for the literal string `prisma.` in
`server/src/api/enrolments/enrolments.service.ts` and
`server/src/api/applications/applications.schema.ts` are inside
explanatory comments, not code.

## What this file is for

If a future change cannot avoid bypassing the repository pattern (e.g.
a transactional read across two domains where wrapping a transaction
through the repo layer would create a circular dependency), the change
must:

1. Land on a feature branch alongside the bypass.
2. Add an entry to this file with: file path, line range, the exact
   bypass, the rationale, the unit test that covers the behaviour,
   and the planned phase to refactor it back into the repository
   layer.
3. Reference this file in the PR body and the commit message.

## Active exceptions

| File | Lines | Reason | Test | Planned refactor |
|------|-------|--------|------|------------------|
| _(none)_ | | | | |

## Closed exceptions (historical)

None recorded. Earlier overrides under the Phase 11 / Phase 12 cleanup
were closed by the Phase 13b "All 66 deprecated `emitEvent` call-sites
migrated" pass and the Phase 16D "enrolment cascade now goes through
moduleRegistration repository helpers" pass — see `CLAUDE.md` for the
narrative and `docs/KNOWN_ISSUES.md` for the corresponding KI rows
(KI-P11-001 closed, KI-P12-001 closed).
