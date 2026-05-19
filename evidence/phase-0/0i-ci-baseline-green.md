# Batch 0I — CI baseline green

> **Captured:** 2026-05-19
> **Companion to:** [`docs/phase-0/README.md`](../../docs/phase-0/README.md) batch 0I row.

## Problem this PR fixes

Six PRs merged on 2026-05-18 (0H #41, 0M #42, 0K #43, 0J #48, 0F #44, plus my D12 #49) interacted in an order that left the **root `package.json` out of sync with both lockfiles**:

1. D12 (#49) added `vitest@^2.1.8` (devDeps) and `seedrandom@^3.0.5` (deps) at the root, with matching `package-lock.json` + `pnpm-lock.yaml` updates.
2. PR #44 (0F — JWT fallback removal) was branched from a pre-D12 base. When it merged, its squashed `package.json` reverted both additions — likely an unintended consequence of the rebase, since the PR title is unrelated to dependencies.
3. The post-#44 main therefore had a `package.json` declaring only `@prisma/client`, `prisma`, `tsx`, `zod` while:
   - **`package-lock.json`** still referenced the SJMS-2.5-era state, missing the peer-optional `magicast` transitive that `@prisma/config` pulls in under newer npm.
   - **`pnpm-lock.yaml`** still expected `seedrandom@^3.0.5` + `vitest@^2.1.8`.

**Symptom:** `npm ci` and `pnpm install --frozen-lockfile` both failed on PR runs. That cascaded through every CI workflow that installs deps as a first step:

- **SBOM** (`Generate CycloneDX SBOM`) — `npm ci` exit 1
- **Trivy** (`Container scan`, x2 images) — `npm ci` exit 1
- **Checkov** (`IaC scan`) — installs npm before Docker context
- **npm audit** (`Security audit`) — `npm ci` exit 1
- **Lint advisory** — `npm ci` exit 1
- **Vitest + byte-determinism** (Dataset CI) — `pnpm install --frozen-lockfile` exit 1
- **claude-review** — install step
- **Quality gates** (server / client / root) — install step

All seven failing checks on PR #44 itself had the same root cause; #44 merged anyway because the failing checks were advisory (no blocking required-checks set on main yet — that's batch 0K's reach-ratchet target).

## What 0I changes

Restores the root dependency-declaration alignment that #44 inadvertently reverted, and regenerates both lockfiles cleanly against it. Two-file change:

| File | Change |
|---|---|
| `package.json` | Re-adds `vitest@^2.1.8` to `devDependencies` and `seedrandom@^3.0.5` to `dependencies`. |
| `package-lock.json` | Regenerated via `npm install`. Reconciles the spine's runtime deps (`@prisma/client`, `prisma`, `tsx`, `zod`) and adds the peer-optional `magicast@0.3.5` transitive that `@prisma/config` pulls in under npm 10. |

`pnpm-lock.yaml` was already consistent with the restored `package.json` (`pnpm install --frozen-lockfile` is now clean without changes — verified post-regen).

## Verification

```
$ rm -rf node_modules && npm ci --ignore-scripts
added 815 packages, and audited 816 packages in ...
5 moderate severity vulnerabilities    # see below

$ rm -rf node_modules && pnpm install --frozen-lockfile --ignore-scripts
Lockfile is up to date, resolution step is skipped
Done in 1.1s

$ pnpm exec vitest run
Test Files  9 passed (9)
     Tests  78 passed (78)
```

| Gate | Status |
|---|---|
| `npm ci` | ✅ passes |
| `pnpm install --frozen-lockfile` | ✅ passes |
| `pnpm exec vitest run` (dataset suite) | ✅ 78/78 passing |
| `npx prisma validate` (with `DATABASE_URL` + `DIRECT_URL` set) | ✅ passes; without them the validator complains about missing env, expected |
| `npx tsc --noEmit` (server) | not run in this PR — server workspace install is needed first, deferred to next CI run |

## npm audit baseline

The restored `vitest@^2.1.8` (and through it `vite`, `vite-node`) carries **5 moderate-severity transitives** that vitest 2 has never patched:

```
brace-expansion       5.0.2 - 5.0.5   GHSA-jxxr-4gwj-5jf2  DoS via numeric range
+ 4 transitive findings on vite / vite-node / @vitejs/...
```

These are **dev-time only** (vitest runs in test, not at runtime in the deployed Function or Container). The vulnerabilities cannot reach production. Two paths to close them, deferred:

1. **Upgrade root vitest to v4** to match `server/package.json` already (v4.1.5+). Requires a one-line bump + regeneration of the lockfiles + a smoke run of `scripts/test/` to confirm the dataset tests still work on v4. Tracked as `KI-S5-401`.
2. **Move vitest out of root** into workspace-specific configs. Larger refactor; not Phase 0 scope.

Until then, `npm audit` returns a moderate-severity baseline; the `Security audit` workflow is configured to fail on **high or critical** so it won't block merges on moderate dev-only transitives.

## What 0I does NOT do

- **TypeScript baseline ratchet** — `tsc --noEmit` for server and client. Tracked separately as part of Phase 15 (server/client coverage already enforced via `vitest.config.ts` threshold per Phase 17F).
- **Lint baseline ratchet** — `KI-S5-001` (eslint advisory → blocking) is sequenced to Phase 15B's `fix/eslint-baseline` branch.
- **k6 advisory wiring** — separate batch 0E, landing via PR #67.
- **Dependabot alerts enforcement** — separate batch 0N (operator-driven UI step).
- **Branch-protection required-check list** — separate batch 0K (LANDED via PR #43; reach-ratchet to add 0I's now-green checks is a follow-on).

## Acceptance signal

Once this merges:

- `npm ci` and `pnpm install --frozen-lockfile` both pass on a fresh checkout of `main`.
- The supply-chain workflows (SBOM, Trivy, Checkov) no longer fail at the install step.
- The dataset CI's vitest run passes again on every PR (it broke for every PR after #44 merged).
- `Security audit` reports the 5 moderate vulns as baseline; high/critical findings still block.

Subsequent Phase 0 PRs (0C, 0D, 0L, 0N) and any Phase 1+ PRs land against a CI baseline that is reproducibly installable. KI-S5-401 stays open for the vitest v4 ratchet.
