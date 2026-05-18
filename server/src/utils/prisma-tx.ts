import type { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * Phase 18C — service-layer transaction wrapper.
 *
 * Services orchestrate atomic multi-repository writes by passing a
 * `Prisma.TransactionClient` (`tx`) into transaction-aware repository
 * helpers. Importing `prisma` directly into a service to call
 * `prisma.$transaction` would violate Gate 4 (direct Prisma usage in
 * services). This thin wrapper lives in `utils/` so the service can
 * open a transaction without importing the Prisma client surface.
 *
 * Usage:
 * ```ts
 * await runInTransaction(async (tx) => {
 *   await someRepo.doStuffInTx(tx);
 *   await otherRepo.doMoreStuffInTx(tx);
 * });
 * ```
 */
export function runInTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(callback);
}
