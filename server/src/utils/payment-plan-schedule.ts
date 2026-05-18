/**
 * Phase 18D — Payment plan schedule (pure utility).
 *
 * Generates an instalment schedule for a PaymentPlan. Given a total
 * amount, an instalment count, and a start date, this module returns
 * the per-instalment due dates and amounts. Pure: no Prisma, no I/O,
 * no environmental coupling — same purity contract as
 * `marks-aggregation` (17A), `progression-decision` /
 * `award-classification` (17D), `transcript-composition` (17E),
 * `fee-calculation` (18A), `invoice-composition` (18B), and
 * `payment-allocation` (18C).
 *
 * Three frequencies:
 *
 *   - **MONTHLY** (default): +1 calendar month per instalment, with
 *     month-end clipping so a 31 January start lands on the last
 *     valid day of February (28 or 29 depending on leap year), then
 *     31 March, 30 April, 31 May, etc. This matches typical UK HE
 *     monthly fee plans where the start date is the day of issue.
 *   - **QUARTERLY**: +3 calendar months per instalment, same
 *     month-end-clipping behaviour.
 *   - **CUSTOM**: caller supplies a `customDates: Date[]` array whose
 *     length must equal `numberOfInstalments`. The composer copies
 *     the dates verbatim. Useful for irregular schedules tied to
 *     academic semester boundaries (e.g. 1 October, 1 February,
 *     1 May for a 3-instalment plan).
 *
 * Amount distribution: every instalment receives `round(totalAmount /
 * numberOfInstalments, 2)` except the last, which absorbs any
 * rounding drift so `sum(amounts) === totalAmount` exactly to 2 dp.
 * For example, £1,000 / 3 → 333.33 + 333.33 + 333.34. The drift sits
 * on the last instalment rather than the first because typical UK HE
 * monthly plans want the early instalments to be predictable round
 * numbers; the variance gets pushed to the end of the schedule.
 *
 * Defensive guards:
 *   - `numberOfInstalments <= 0` → empty schedule + diagnostic note
 *   - `totalAmount <= 0` → empty schedule + diagnostic note
 *   - non-finite numeric inputs → treated as zero
 *   - CUSTOM frequency without `customDates` (or with the wrong
 *     length) → empty schedule + diagnostic note
 */

export type InstalmentFrequency = 'MONTHLY' | 'QUARTERLY' | 'CUSTOM';

export interface PaymentPlanScheduleInput {
  totalAmount: number;
  numberOfInstalments: number;
  startDate: Date;
  /** Default `'MONTHLY'`. */
  frequency?: InstalmentFrequency;
  /** Required when `frequency === 'CUSTOM'`. Length must equal `numberOfInstalments`. */
  customDates?: ReadonlyArray<Date>;
}

export interface InstalmentSchedule {
  instalmentNum: number;
  amount: number;
  dueDate: Date;
}

export interface PaymentPlanScheduleOutcome {
  frequency: InstalmentFrequency;
  totalAmount: number;
  numberOfInstalments: number;
  /** The pre-drift uniform per-instalment amount (rounded to 2 dp). */
  baseAmount: number;
  /** The amount applied to the last instalment to make `sum(amounts) === totalAmount`. */
  driftAdjustment: number;
  instalments: InstalmentSchedule[];
  /** The effective start date used by the composer (echoes `input.startDate`). */
  effectiveStart: Date;
  /** Operator-facing notes (e.g. zero-amount, custom-dates length mismatch). */
  notes: string[];
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function nonNegativeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value;
}

/**
 * Add `months` calendar months to a date, clipping to the last valid
 * day of the target month so 31 January + 1 month → 28/29 February
 * (rather than the JavaScript Date default of "rolling over" to
 * 3 March). Pure — does not mutate the input.
 */
function addMonthsClipped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonth = month + months;
  // Build the target month's last-day pivot in UTC, then clip the
  // day to that month's max so 31 → 30 / 28 / 29 as appropriate.
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const clippedDay = Math.min(day, lastDay);
  return new Date(Date.UTC(year, targetMonth, clippedDay));
}

function buildDueDates(
  startDate: Date,
  numberOfInstalments: number,
  frequency: InstalmentFrequency,
  customDates: ReadonlyArray<Date> | undefined,
): { dueDates: Date[]; notes: string[] } {
  const notes: string[] = [];

  if (frequency === 'CUSTOM') {
    if (!customDates || customDates.length !== numberOfInstalments) {
      notes.push(
        `CUSTOM frequency requires customDates.length === numberOfInstalments (got ${customDates?.length ?? 0} vs ${numberOfInstalments}).`,
      );
      return { dueDates: [], notes };
    }
    return {
      dueDates: customDates.map((d) => new Date(d.getTime())),
      notes,
    };
  }

  const monthsPerStep = frequency === 'QUARTERLY' ? 3 : 1;
  const dueDates: Date[] = [];
  for (let i = 0; i < numberOfInstalments; i += 1) {
    dueDates.push(addMonthsClipped(startDate, i * monthsPerStep));
  }
  return { dueDates, notes };
}

/**
 * Generate the instalment schedule for a PaymentPlan.
 *
 * Pure — no Prisma, no I/O. Returns a structured outcome so the I/O
 * orchestrator (`payment-plans.service`) can drive the persistence
 * write through `paymentPlan.repository.createWithInstalments`. The
 * outcome always satisfies:
 *
 *   - `instalments.length === numberOfInstalments` (or 0 on validation failure)
 *   - `sum(instalments[i].amount) === totalAmount` (rounded to 2 dp)
 *   - `instalments[0].dueDate.getTime() === startDate.getTime()` for MONTHLY/QUARTERLY
 *   - `effectiveStart.getTime() === startDate.getTime()`
 */
export function generatePlanSchedule(
  input: PaymentPlanScheduleInput,
): PaymentPlanScheduleOutcome {
  const frequency: InstalmentFrequency = input.frequency ?? 'MONTHLY';
  const totalAmount = round2(nonNegativeNumber(input.totalAmount));
  const numberOfInstalments =
    Number.isFinite(input.numberOfInstalments) && input.numberOfInstalments > 0
      ? Math.floor(input.numberOfInstalments)
      : 0;
  const effectiveStart = new Date(input.startDate.getTime());

  const notes: string[] = [];

  if (numberOfInstalments === 0) {
    notes.push('numberOfInstalments must be a positive integer — no instalments generated.');
    return {
      frequency,
      totalAmount,
      numberOfInstalments: 0,
      baseAmount: 0,
      driftAdjustment: 0,
      instalments: [],
      effectiveStart,
      notes,
    };
  }

  if (totalAmount === 0) {
    notes.push('totalAmount must be positive — no instalments generated.');
    return {
      frequency,
      totalAmount,
      numberOfInstalments,
      baseAmount: 0,
      driftAdjustment: 0,
      instalments: [],
      effectiveStart,
      notes,
    };
  }

  const { dueDates, notes: dateNotes } = buildDueDates(
    effectiveStart,
    numberOfInstalments,
    frequency,
    input.customDates,
  );
  notes.push(...dateNotes);

  if (dueDates.length === 0) {
    return {
      frequency,
      totalAmount,
      numberOfInstalments,
      baseAmount: 0,
      driftAdjustment: 0,
      instalments: [],
      effectiveStart,
      notes,
    };
  }

  const baseAmount = round2(totalAmount / numberOfInstalments);
  const sumOfBase = round2(baseAmount * numberOfInstalments);
  const driftAdjustment = round2(totalAmount - sumOfBase);

  const instalments: InstalmentSchedule[] = dueDates.map((dueDate, index) => {
    const isLast = index === numberOfInstalments - 1;
    const amount = isLast ? round2(baseAmount + driftAdjustment) : baseAmount;
    return {
      instalmentNum: index + 1,
      amount,
      dueDate,
    };
  });

  return {
    frequency,
    totalAmount,
    numberOfInstalments,
    baseAmount,
    driftAdjustment,
    instalments,
    effectiveStart,
    notes,
  };
}
