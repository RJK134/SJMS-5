import { describe, expect, it } from 'vitest';
import { generatePlanSchedule } from '../../utils/payment-plan-schedule';

describe('generatePlanSchedule (Phase 18D pure utility)', () => {
  it('generates a 3-instalment monthly schedule with even amounts', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 900,
      numberOfInstalments: 3,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.frequency).toBe('MONTHLY');
    expect(outcome.numberOfInstalments).toBe(3);
    expect(outcome.baseAmount).toBe(300);
    expect(outcome.driftAdjustment).toBe(0);
    expect(outcome.instalments).toHaveLength(3);
    expect(outcome.instalments.map((i) => i.amount)).toEqual([300, 300, 300]);
    expect(outcome.instalments.map((i) => i.instalmentNum)).toEqual([1, 2, 3]);
    expect(outcome.notes).toEqual([]);
  });

  it('absorbs rounding drift into the last instalment', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 1000,
      numberOfInstalments: 3,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.baseAmount).toBe(333.33);
    expect(outcome.driftAdjustment).toBe(0.01);
    expect(outcome.instalments.map((i) => i.amount)).toEqual([333.33, 333.33, 333.34]);
    const sum = outcome.instalments.reduce((total, i) => Math.round((total + i.amount) * 100) / 100, 0);
    expect(sum).toBe(1000);
  });

  it('handles negative-drift cases (1000 / 7 → last instalment absorbs the floor drift)', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 1000,
      numberOfInstalments: 7,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    // 1000 / 7 = 142.857… → round → 142.86 × 7 = 1000.02 → drift = -0.02
    expect(outcome.baseAmount).toBe(142.86);
    expect(outcome.driftAdjustment).toBe(-0.02);
    expect(outcome.instalments[6]?.amount).toBe(142.84);
    const sum = outcome.instalments.reduce((total, i) => Math.round((total + i.amount) * 100) / 100, 0);
    expect(sum).toBe(1000);
  });

  it('clips month-end dates so 31 January + 1 month lands on 28 February', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 600,
      numberOfInstalments: 3,
      startDate: new Date(Date.UTC(2026, 0, 31)),
    });

    expect(outcome.instalments[0]?.dueDate.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(outcome.instalments[1]?.dueDate.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(outcome.instalments[2]?.dueDate.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('clips to 29 February in a leap year (2028)', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 200,
      numberOfInstalments: 2,
      startDate: new Date(Date.UTC(2028, 0, 31)),
    });

    expect(outcome.instalments[1]?.dueDate.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('walks quarterly schedules with a 3-month step', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 1200,
      numberOfInstalments: 4,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      frequency: 'QUARTERLY',
    });

    expect(outcome.frequency).toBe('QUARTERLY');
    expect(outcome.instalments.map((i) => i.dueDate.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
    ]);
    expect(outcome.instalments.map((i) => i.amount)).toEqual([300, 300, 300, 300]);
  });

  it('honours CUSTOM dates verbatim when length matches', () => {
    const dates = [
      new Date(Date.UTC(2026, 9, 1)),
      new Date(Date.UTC(2027, 1, 1)),
      new Date(Date.UTC(2027, 4, 1)),
    ];
    const outcome = generatePlanSchedule({
      totalAmount: 9000,
      numberOfInstalments: 3,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      frequency: 'CUSTOM',
      customDates: dates,
    });

    expect(outcome.frequency).toBe('CUSTOM');
    expect(outcome.instalments.map((i) => i.dueDate.toISOString())).toEqual(
      dates.map((d) => d.toISOString()),
    );
    expect(outcome.instalments.map((i) => i.amount)).toEqual([3000, 3000, 3000]);
    expect(outcome.notes).toEqual([]);
  });

  it('rejects CUSTOM frequency without a matching customDates array', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 9000,
      numberOfInstalments: 3,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      frequency: 'CUSTOM',
    });

    expect(outcome.instalments).toEqual([]);
    expect(outcome.notes.some((n) => n.includes('CUSTOM frequency requires customDates'))).toBe(true);
  });

  it('rejects CUSTOM frequency with the wrong customDates length', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 9000,
      numberOfInstalments: 3,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      frequency: 'CUSTOM',
      customDates: [new Date(Date.UTC(2026, 9, 1))],
    });

    expect(outcome.instalments).toEqual([]);
    expect(outcome.notes.some((n) => n.includes('got 1 vs 3'))).toBe(true);
  });

  it('returns an empty schedule with a note when numberOfInstalments is zero', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 1000,
      numberOfInstalments: 0,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.numberOfInstalments).toBe(0);
    expect(outcome.instalments).toEqual([]);
    expect(outcome.notes.some((n) => n.includes('numberOfInstalments must be a positive integer'))).toBe(true);
  });

  it('returns an empty schedule with a note when totalAmount is zero', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 0,
      numberOfInstalments: 5,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.totalAmount).toBe(0);
    expect(outcome.instalments).toEqual([]);
    expect(outcome.notes.some((n) => n.includes('totalAmount must be positive'))).toBe(true);
  });

  it('treats negative totalAmount as zero', () => {
    const outcome = generatePlanSchedule({
      totalAmount: -500,
      numberOfInstalments: 3,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.totalAmount).toBe(0);
    expect(outcome.instalments).toEqual([]);
  });

  it('treats negative numberOfInstalments as zero', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 500,
      numberOfInstalments: -2,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.numberOfInstalments).toBe(0);
    expect(outcome.instalments).toEqual([]);
  });

  it('floors fractional numberOfInstalments to the nearest integer', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 600,
      numberOfInstalments: 3.7,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.numberOfInstalments).toBe(3);
    expect(outcome.instalments).toHaveLength(3);
  });

  it('treats non-finite totalAmount as zero', () => {
    const outcome = generatePlanSchedule({
      totalAmount: Number.NaN,
      numberOfInstalments: 3,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.totalAmount).toBe(0);
    expect(outcome.instalments).toEqual([]);
  });

  it('preserves effectiveStart equal to the input startDate', () => {
    const startDate = new Date(Date.UTC(2026, 5, 15));
    const outcome = generatePlanSchedule({
      totalAmount: 1200,
      numberOfInstalments: 4,
      startDate,
    });

    expect(outcome.effectiveStart.getTime()).toBe(startDate.getTime());
    expect(outcome.instalments[0]?.dueDate.getTime()).toBe(startDate.getTime());
  });

  it('produces a deterministic schedule across runs', () => {
    const input = {
      totalAmount: 1234.56,
      numberOfInstalments: 5,
      startDate: new Date(Date.UTC(2026, 8, 30)),
    };
    const a = generatePlanSchedule(input);
    const b = generatePlanSchedule(input);
    expect(a).toEqual(b);
  });

  it('keeps sum(amounts) === totalAmount across a range of awkward divisions', () => {
    const totals = [100, 99.99, 1234.56, 7.77, 13.5, 0.03];
    const counts = [3, 7, 11, 12];
    for (const totalAmount of totals) {
      for (const numberOfInstalments of counts) {
        const outcome = generatePlanSchedule({
          totalAmount,
          numberOfInstalments,
          startDate: new Date(Date.UTC(2026, 0, 1)),
        });
        const sum = outcome.instalments.reduce(
          (total, i) => Math.round((total + i.amount) * 100) / 100,
          0,
        );
        expect(sum).toBe(Math.round(totalAmount * 100) / 100);
      }
    }
  });

  it('handles a single-instalment schedule (full amount, single date)', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 500,
      numberOfInstalments: 1,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.instalments).toHaveLength(1);
    expect(outcome.instalments[0]?.amount).toBe(500);
    expect(outcome.instalments[0]?.dueDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('numbers instalments starting at 1', () => {
    const outcome = generatePlanSchedule({
      totalAmount: 600,
      numberOfInstalments: 6,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(outcome.instalments.map((i) => i.instalmentNum)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
