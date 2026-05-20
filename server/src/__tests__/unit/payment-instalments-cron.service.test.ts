/**
 * Phase 1A — payment-instalment cron unit tests.
 *
 * Covers the `processOverdueInstalments` service method that the daily
 * BullMQ cron calls. Mocks every repository so the test does not touch
 * Prisma. Mocks the audit + event helpers to keep assertions narrow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module mocks must be declared before the import-under-test.
vi.mock('../../repositories/paymentInstalment.repository');
vi.mock('../../repositories/chargeLine.repository');
vi.mock('../../repositories/finance.repository');
vi.mock('../../utils/audit');
vi.mock('../../utils/webhooks');

import * as repo from '../../repositories/paymentInstalment.repository';
import * as chargeLineRepo from '../../repositories/chargeLine.repository';
import * as financeRepo from '../../repositories/finance.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';
import { processOverdueInstalments } from '../../api/payment-instalments/payment-instalments.service';

const FIXED_NOW = new Date('2026-05-19T12:00:00.000Z');

function makePlan(overrides: Partial<{ id: string; studentAccountId: string; numberOfInstalments: number }> = {}) {
  return {
    id: overrides.id ?? 'plan-1',
    studentAccountId: overrides.studentAccountId ?? 'sa-1',
    numberOfInstalments: overrides.numberOfInstalments ?? 3,
  };
}

function makeInstalment(overrides: Partial<{
  id: string;
  instalmentNum: number;
  amount: number;
  dueDate: Date;
  paymentPlanId: string;
  status: string;
  paymentPlan: ReturnType<typeof makePlan>;
}> = {}) {
  const plan = overrides.paymentPlan ?? makePlan({ id: overrides.paymentPlanId });
  return {
    id: overrides.id ?? 'inst-1',
    instalmentNum: overrides.instalmentNum ?? 1,
    amount: overrides.amount ?? 250,
    dueDate: overrides.dueDate ?? new Date('2026-05-01T00:00:00.000Z'),
    paymentPlanId: plan.id,
    status: overrides.status ?? 'PENDING',
    paymentPlan: plan,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('payment-instalments.service.processOverdueInstalments', () => {
  it('returns total:0 / charged:0 when no overdue instalments', async () => {
    (repo.findOverdue as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const outcome = await processOverdueInstalments({ asOf: FIXED_NOW, trigger: 'cron' });

    expect(outcome).toMatchObject({
      asOf: FIXED_NOW.toISOString(),
      trigger: 'cron',
      total: 0,
      charged: 0,
      skipped: 0,
      failed: 0,
      results: [],
    });
    expect(financeRepo.createCharge).not.toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment_instalment.cron_processed' }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      'PaymentInstalmentCron',
      FIXED_NOW.toISOString(),
      'CREATE',
      expect.any(String),
      null,
      expect.objectContaining({ total: 0 }),
      undefined,
    );
  });

  it('issues a ChargeLine for each overdue PENDING instalment', async () => {
    const inst = makeInstalment();
    (repo.findOverdue as ReturnType<typeof vi.fn>).mockResolvedValue([inst]);
    (chargeLineRepo.findByInstalmentMarker as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (financeRepo.createCharge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cl-1' });

    const outcome = await processOverdueInstalments({ asOf: FIXED_NOW, trigger: 'cron' });

    expect(outcome.total).toBe(1);
    expect(outcome.charged).toBe(1);
    expect(outcome.skipped).toBe(0);
    expect(outcome.failed).toBe(0);

    expect(financeRepo.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        studentAccountId: 'sa-1',
        chargeType: 'OTHER',
        amount: 250,
        currency: 'GBP',
        status: 'PENDING',
        description: expect.stringContaining('[instalment:inst-1]'),
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment_instalment.due',
        entityId: 'inst-1',
        data: expect.objectContaining({
          chargeLineId: 'cl-1',
          paymentPlanId: 'plan-1',
          studentAccountId: 'sa-1',
        }),
      }),
    );
  });

  it('embeds the [instalment:id] idempotency marker in the description', async () => {
    const inst = makeInstalment({ id: 'inst-xyz', instalmentNum: 2 });
    (repo.findOverdue as ReturnType<typeof vi.fn>).mockResolvedValue([inst]);
    (chargeLineRepo.findByInstalmentMarker as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (financeRepo.createCharge as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cl-1' });

    await processOverdueInstalments({ asOf: FIXED_NOW });

    const data = (financeRepo.createCharge as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(data.description).toContain('Instalment 2 of 3');
    expect(data.description).toContain('[instalment:inst-xyz]');
    expect(data.description).toContain('plan plan-1');
  });

  it('skips instalments that already have a ChargeLine (idempotent re-run)', async () => {
    const inst = makeInstalment();
    (repo.findOverdue as ReturnType<typeof vi.fn>).mockResolvedValue([inst]);
    (chargeLineRepo.findByInstalmentMarker as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'cl-existing',
      status: 'PENDING',
    });

    const outcome = await processOverdueInstalments({ asOf: FIXED_NOW });

    expect(outcome.charged).toBe(0);
    expect(outcome.skipped).toBe(1);
    expect(financeRepo.createCharge).not.toHaveBeenCalled();
    expect(outcome.results[0]).toMatchObject({
      instalmentId: 'inst-1',
      status: 'skipped',
      chargeLineId: 'cl-existing',
      reason: expect.stringContaining('charge-line-already-issued'),
    });
  });

  it('isolates per-row failures — one failing row does not abort the run', async () => {
    const good = makeInstalment({ id: 'good' });
    const bad = makeInstalment({ id: 'bad' });
    (repo.findOverdue as ReturnType<typeof vi.fn>).mockResolvedValue([good, bad]);
    (chargeLineRepo.findByInstalmentMarker as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (financeRepo.createCharge as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'cl-good' })
      .mockRejectedValueOnce(new Error('db connection lost'));

    const outcome = await processOverdueInstalments({ asOf: FIXED_NOW });

    expect(outcome.total).toBe(2);
    expect(outcome.charged).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.results[0]).toMatchObject({ instalmentId: 'good', status: 'charged' });
    expect(outcome.results[1]).toMatchObject({
      instalmentId: 'bad',
      status: 'failed',
      reason: expect.stringContaining('db connection lost'),
    });
  });

  it('defaults asOf to now() when not provided', async () => {
    (repo.findOverdue as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const before = Date.now();
    const outcome = await processOverdueInstalments();
    const after = Date.now();
    const asOfMs = new Date(outcome.asOf).getTime();
    expect(asOfMs).toBeGreaterThanOrEqual(before);
    expect(asOfMs).toBeLessThanOrEqual(after);
    expect(outcome.trigger).toBe('manual');
  });

  it('marks rows failed (not crashed) when paymentPlan is not loaded', async () => {
    const orphan = { ...makeInstalment(), paymentPlan: null as unknown as ReturnType<typeof makePlan> };
    (repo.findOverdue as ReturnType<typeof vi.fn>).mockResolvedValue([orphan]);

    const outcome = await processOverdueInstalments({ asOf: FIXED_NOW });

    expect(outcome.failed).toBe(1);
    expect(outcome.charged).toBe(0);
    expect(financeRepo.createCharge).not.toHaveBeenCalled();
    expect(outcome.results[0]).toMatchObject({
      instalmentId: 'inst-1',
      status: 'failed',
      reason: expect.stringContaining('parent PaymentPlan not loaded'),
    });
  });

  it('forwards trigger=cron through to the summary event payload', async () => {
    (repo.findOverdue as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await processOverdueInstalments({ asOf: FIXED_NOW, trigger: 'cron' });

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment_instalment.cron_processed',
        data: expect.objectContaining({ trigger: 'cron' }),
      }),
    );
  });
});
