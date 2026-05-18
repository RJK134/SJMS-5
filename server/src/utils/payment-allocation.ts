/**
 * Phase 18C — Payment allocation (pure utility).
 *
 * Allocates a single Payment amount across a set of open ChargeLines
 * for the same StudentAccount. This module is intentionally pure: no
 * Prisma, no I/O, no environmental coupling — same purity contract
 * as `marks-aggregation` (17A), `progression-decision` /
 * `award-classification` (17D), `transcript-composition` (17E),
 * `fee-calculation` (18A), and `invoice-composition` (18B).
 *
 * Two allocation strategies:
 *
 *   - **FIFO** (default): walk the open charges in due-date order
 *     (then created-date order as a tiebreak), fully covering each
 *     charge until the payment amount is exhausted. The ChargeLine
 *     that consumes the last available payment may be partially
 *     covered (returned with `fullyCovered: false`); subsequent
 *     ChargeLines receive zero allocation. This matches standard UK
 *     HE finance practice — a £1,000 payment against a £600 + £600
 *     pair pays the first £600 in full and £400 of the second.
 *
 *   - **PROPORTIONAL**: distribute the payment across all open
 *     charges pro rata against each charge's outstanding amount.
 *     Useful for sponsor-bulk allocations where the operator wants
 *     to reduce every charge by a fraction. Rounding error from the
 *     proportional split is absorbed into the last allocation line
 *     so `sum(allocations) === paymentAmount` holds exactly to 2 dp.
 *
 * Allocation outcomes are advisory: the I/O orchestrator
 * (`payments.service`) decides what to mutate. The composer's job
 * is to express how a payment SHOULD apply, given the current open
 * charges, with a deterministic and auditable breakdown.
 */

export type AllocationStrategy = 'FIFO' | 'PROPORTIONAL';

export interface OpenChargeInput {
  id: string;
  invoiceId: string | null;
  amount: number;
  /** Already-applied payment against this charge (for partial-credit charges). Defaults to 0. */
  alreadyAllocated?: number;
  /** Used by FIFO ordering. May be null for charges with no due date. */
  dueDate?: Date | null;
  /** Used by FIFO ordering as a tiebreak. */
  createdAt?: Date | null;
}

export interface PaymentAllocationInput {
  paymentAmount: number;
  openCharges: ReadonlyArray<OpenChargeInput>;
  strategy?: AllocationStrategy;
}

export interface PaymentAllocationLine {
  chargeLineId: string;
  invoiceId: string | null;
  /** Charge-side outstanding before this allocation (charge amount minus prior allocations). Always >= 0. */
  outstandingBefore: number;
  /** Amount applied by this allocation. Always >= 0 and <= outstandingBefore. */
  amount: number;
  /** True when this allocation pays off the entire outstanding amount on the charge. */
  fullyCovered: boolean;
}

export interface PaymentAllocationOutcome {
  strategy: AllocationStrategy;
  paymentAmount: number;
  totalAllocated: number;
  /** Payment amount that did not land on any charge (overpayment / no open charges). */
  leftover: number;
  /** True when totalAllocated === paymentAmount (no leftover). */
  fullyAllocated: boolean;
  allocations: PaymentAllocationLine[];
  /** Charges that received a non-zero allocation, by invoice (handy for invoice.paidAmount updates). */
  invoiceImpact: { invoiceId: string; amount: number }[];
  /** Operator-facing notes (e.g. overpayment, no-open-charges). */
  notes: string[];
}

const ZERO = 0;

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function nonNegativeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value;
}

function outstandingFor(charge: OpenChargeInput): number {
  const total = nonNegativeNumber(charge.amount);
  const applied = nonNegativeNumber(charge.alreadyAllocated ?? 0);
  const remaining = round2(total - applied);
  return remaining < 0 ? 0 : remaining;
}

function compareForFifo(a: OpenChargeInput, b: OpenChargeInput): number {
  // null dueDate sorts last so dated charges are always paid first.
  const aDue = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bDue = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;

  const aCreated = a.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bCreated = b.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aCreated !== bCreated) return aCreated - bCreated;

  // Final tiebreak — id ordering keeps the function deterministic.
  return a.id.localeCompare(b.id);
}

function aggregateInvoiceImpact(
  allocations: ReadonlyArray<PaymentAllocationLine>,
): { invoiceId: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const allocation of allocations) {
    if (!allocation.invoiceId || allocation.amount <= 0) continue;
    const previous = map.get(allocation.invoiceId) ?? 0;
    map.set(allocation.invoiceId, round2(previous + allocation.amount));
  }
  return Array.from(map.entries()).map(([invoiceId, amount]) => ({ invoiceId, amount }));
}

function allocateFifo(
  paymentAmount: number,
  openCharges: ReadonlyArray<OpenChargeInput>,
): PaymentAllocationLine[] {
  const sorted = [...openCharges].sort(compareForFifo);
  const allocations: PaymentAllocationLine[] = [];
  let remaining = round2(paymentAmount);

  for (const charge of sorted) {
    const outstanding = outstandingFor(charge);
    if (outstanding === 0) continue;

    if (remaining <= 0) {
      allocations.push({
        chargeLineId: charge.id,
        invoiceId: charge.invoiceId,
        outstandingBefore: outstanding,
        amount: 0,
        fullyCovered: false,
      });
      continue;
    }

    const applied = round2(Math.min(remaining, outstanding));
    allocations.push({
      chargeLineId: charge.id,
      invoiceId: charge.invoiceId,
      outstandingBefore: outstanding,
      amount: applied,
      fullyCovered: applied >= outstanding,
    });
    remaining = round2(remaining - applied);
  }

  return allocations;
}

function allocateProportional(
  paymentAmount: number,
  openCharges: ReadonlyArray<OpenChargeInput>,
): PaymentAllocationLine[] {
  const totalOutstanding = openCharges.reduce(
    (sum, charge) => round2(sum + outstandingFor(charge)),
    0,
  );

  if (totalOutstanding <= 0) {
    return openCharges.map((charge) => ({
      chargeLineId: charge.id,
      invoiceId: charge.invoiceId,
      outstandingBefore: 0,
      amount: 0,
      fullyCovered: false,
    }));
  }

  // Cap the proportional pool at the total outstanding — there is no
  // sensible way to over-allocate proportionally.
  const pool = round2(Math.min(paymentAmount, totalOutstanding));

  const allocations: PaymentAllocationLine[] = openCharges.map((charge) => {
    const outstanding = outstandingFor(charge);
    if (outstanding === 0 || pool === 0) {
      return {
        chargeLineId: charge.id,
        invoiceId: charge.invoiceId,
        outstandingBefore: outstanding,
        amount: 0,
        fullyCovered: false,
      };
    }
    const share = round2((outstanding / totalOutstanding) * pool);
    return {
      chargeLineId: charge.id,
      invoiceId: charge.invoiceId,
      outstandingBefore: outstanding,
      amount: share,
      fullyCovered: share >= outstanding,
    };
  });

  // Rounding error absorption — push any drift onto the last
  // non-zero allocation so sum(allocations) === pool exactly.
  const sumOfShares = allocations.reduce((sum, a) => round2(sum + a.amount), 0);
  const drift = round2(pool - sumOfShares);
  if (drift !== 0) {
    for (let i = allocations.length - 1; i >= 0; i -= 1) {
      const allocation = allocations[i];
      if (allocation.amount > 0 || allocation.outstandingBefore > 0) {
        const adjusted = round2(allocation.amount + drift);
        // Cap the adjusted amount at outstandingBefore to preserve
        // the per-charge guarantee that `amount <= outstandingBefore`.
        const capped = Math.min(adjusted, allocation.outstandingBefore);
        allocation.amount = capped < 0 ? 0 : capped;
        allocation.fullyCovered = allocation.amount >= allocation.outstandingBefore && allocation.outstandingBefore > 0;
        break;
      }
    }
  }

  return allocations;
}

/**
 * Allocate a single Payment across a set of open ChargeLines.
 *
 * Pure function — no Prisma, no I/O. Returns a structured outcome
 * the I/O orchestrator (`payments.service`) can use to drive the
 * actual mutations. The outcome always satisfies:
 *
 *   - `totalAllocated + leftover === paymentAmount` (rounded to 2 dp)
 *   - `0 <= allocations[i].amount <= allocations[i].outstandingBefore`
 *   - `fullyCovered === (amount >= outstandingBefore && outstandingBefore > 0)`
 *
 * Negative or non-finite `paymentAmount` is treated as zero.
 */
export function allocatePayment(
  input: PaymentAllocationInput,
): PaymentAllocationOutcome {
  const strategy: AllocationStrategy = input.strategy ?? 'FIFO';
  const paymentAmount = round2(nonNegativeNumber(input.paymentAmount));

  const allocations = strategy === 'PROPORTIONAL'
    ? allocateProportional(paymentAmount, input.openCharges)
    : allocateFifo(paymentAmount, input.openCharges);

  const totalAllocated = round2(
    allocations.reduce((sum, a) => sum + a.amount, ZERO),
  );
  const leftover = round2(Math.max(0, paymentAmount - totalAllocated));
  const fullyAllocated = leftover === 0;

  const notes: string[] = [];
  if (input.openCharges.length === 0) {
    notes.push('No open charges to allocate against — full payment will sit on the StudentAccount as a credit balance.');
  } else if (paymentAmount === 0) {
    notes.push('Payment amount is zero — nothing to allocate.');
  } else if (leftover > 0) {
    notes.push(
      `Overpayment of ${leftover.toFixed(2)} — ${leftover.toFixed(2)} will sit on the StudentAccount as a credit balance.`,
    );
  }
  if (totalAllocated > 0 && allocations.every((a) => !a.fullyCovered || a.outstandingBefore === 0)) {
    notes.push('No charge was fully covered by this payment.');
  }

  return {
    strategy,
    paymentAmount,
    totalAllocated,
    leftover,
    fullyAllocated,
    allocations,
    invoiceImpact: aggregateInvoiceImpact(allocations),
    notes,
  };
}
