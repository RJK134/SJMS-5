/**
 * Shared helpers for converting Prisma `Decimal` values (which are returned as
 * opaque objects in runtime) to plain JavaScript numbers.
 *
 * Prisma's `Decimal` type implements `toString()` but is not a `number`, so a
 * plain `Number(value)` cast works after the string conversion. Used across the
 * Phase 18 finance services (fee-assessments, invoices, payments, payment-plans,
 * payment-instalments).
 */

/** Accepts a Prisma Decimal, number, string, null, or undefined and returns a
 * finite JavaScript number.  `null` / `undefined` / non-finite inputs return 0.
 */
export type DecimalLike = { toString(): string } | number | string | null | undefined;

export function toNumber(value: DecimalLike): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(typeof value === 'string' ? value : value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}
