/**
 * Optimistic-locking primitive (batch 1H).
 *
 * Pattern:
 *
 *   1. Read a row, capture its `version`.
 *   2. Run business logic (display, edit, decide).
 *   3. Submit the update, passing the captured `version`.
 *   4. Repository does `UPDATE ... WHERE id = ? AND version = ?
 *      SET ..., version = version + 1`.
 *   5. If the UPDATE affected zero rows, someone else committed first —
 *      throw `OptimisticLockError`. The HTTP layer surfaces this as 409.
 *
 * Why optimistic rather than pessimistic (SELECT FOR UPDATE) locking:
 *
 *   - **No long-held DB locks.** Pessimistic locking holds a row lock
 *     across the user-think-time window — pathological if the operator
 *     leaves the dialog open for an hour and goes to lunch.
 *   - **Stateless HTTP-friendly.** The client carries the version in
 *     the payload; no server-side session state required.
 *   - **Cheap.** A single integer column + an indexed `WHERE`.
 *
 * Helper: `updateWithVersion()` packages the Prisma `updateMany` +
 * version-check + post-update fetch in one place so repositories stay
 * one-liners. Repositories that update one of the seven race-prone
 * models (Application, Enrolment, AssessmentAttempt, ModuleResult,
 * ExamBoardDecision, Invoice, Payment) route through this helper.
 *
 * Service-layer adoption is incremental. A method that currently does:
 *
 *     await repo.update(id, data);
 *
 * keeps working — the version column is invisible. To enrol the method
 * in optimistic locking, change to:
 *
 *     await repo.updateWithVersion(id, expectedVersion, data);
 *
 * The caller becomes responsible for surfacing the version on its way
 * out (e.g. the GET endpoint returns it; the client carries it through
 * the edit dialog; the PATCH sends it back).
 */

import type { Prisma } from "@prisma/client";

import { OptimisticLockError } from "./errors";

/**
 * Tiny shape for "a Prisma delegate that supports updateMany". The actual
 * delegate is concrete-per-model (`prisma.invoice`, `prisma.payment`, etc.)
 * but they all expose the same `updateMany` / `findUniqueOrThrow` contract.
 */
interface VersionableDelegate<TId = string> {
  updateMany: (args: {
    where: { id: TId; version: number; deletedAt?: Prisma.DateTimeNullableFilter | null };
    data: Record<string, unknown>;
  }) => Promise<{ count: number }>;

  findUniqueOrThrow: (args: { where: { id: TId } }) => Promise<unknown>;
}

export interface UpdateWithVersionOptions {
  /** Whether the model has a `deletedAt` soft-delete column. Defaults to true (all 7 1H models have it). */
  softDelete?: boolean;
}

/**
 * Update a row with an optimistic-locking version check.
 *
 *   await updateWithVersion(prisma.invoice, 'Invoice', id, expectedVersion, data);
 *
 * Throws `OptimisticLockError` (→ HTTP 409) if no row matches both the id
 * AND the expected version (i.e. another process moved on).
 *
 * On success, the version increments by 1 and the freshly-read row is
 * returned so the caller has the new version + updated fields for the
 * response.
 *
 * @param delegate One of the Prisma model delegates (e.g. `prisma.invoice`).
 *                 Generic over both id and update-data type for flexibility.
 * @param entityType Used in the error message and the audit log.
 * @param id The primary key of the row.
 * @param expectedVersion The version the caller observed when they read the row.
 * @param data The update payload (anything you'd pass to `update.data`, EXCLUDING `version`).
 */
export async function updateWithVersion<TDelegate extends VersionableDelegate, TResult>(
  delegate: TDelegate,
  entityType: string,
  id: string,
  expectedVersion: number,
  data: Record<string, unknown>,
  options: UpdateWithVersionOptions = {},
): Promise<TResult> {
  const softDelete = options.softDelete ?? true;
  const where = softDelete
    ? { id, version: expectedVersion, deletedAt: null }
    : { id, version: expectedVersion };

  const result = await delegate.updateMany({
    where,
    data: {
      ...data,
      version: { increment: 1 },
    } as Record<string, unknown>,
  });

  if (result.count === 0) {
    throw new OptimisticLockError(entityType, id, expectedVersion);
  }

  return delegate.findUniqueOrThrow({ where: { id } }) as Promise<TResult>;
}
