import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../utils/errors';

vi.mock('../../repositories/bursaryFund.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/bursary-funds/bursary-funds.service';
import * as repo from '../../repositories/bursaryFund.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeFund = {
  id: 'bf-1',
  fundName: 'Hardship Bursary 2025/26',
  fundType: 'HARDSHIP',
  academicYear: '2025/26',
  totalBudget: '50000',
  allocated: '0',
  remaining: '50000',
  eligibility: { householdIncomeMax: 25000 },
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

describe('bursary-funds.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getById()', () => {
    it('returns the fund when found', async () => {
      mockedRepo.getById.mockResolvedValue(fakeFund as any);
      const result = await service.getById('bf-1');
      expect(result).toEqual(fakeFund);
    });

    it('throws NotFoundError when the fund does not exist', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('create()', () => {
    it('creates a fund, audits, and emits bursary_fund.created', async () => {
      mockedRepo.create.mockResolvedValue(fakeFund as any);

      await service.create(
        {
          fundName: 'Hardship Bursary 2025/26',
          fundType: 'HARDSHIP',
          academicYear: '2025/26',
          totalBudget: 50000,
          remaining: 50000,
        } as any,
        'user-42',
        fakeReq,
      );

      expect(mockedRepo.create).toHaveBeenCalledTimes(1);
      expect(mockedLogAudit).toHaveBeenCalledWith(
        'BursaryFund',
        'bf-1',
        'CREATE',
        'user-42',
        null,
        fakeFund,
        fakeReq,
      );
      const event = findEvent('bursary_fund.created');
      expect(event).toBeDefined();
      expect(event!.data).toMatchObject({
        fundName: 'Hardship Bursary 2025/26',
        fundType: 'HARDSHIP',
        totalBudget: 50000,
        remaining: 50000,
      });
    });
  });

  describe('update()', () => {
    it('emits bursary_fund.updated with allocated / remaining amounts', async () => {
      const previous = { ...fakeFund };
      const updated = { ...fakeFund, allocated: '10000', remaining: '40000' };
      mockedRepo.getById.mockResolvedValue(previous as any);
      mockedRepo.update.mockResolvedValue(updated as any);

      await service.update('bf-1', { allocated: 10000, remaining: 40000 } as any, 'user-42', fakeReq);

      const event = findEvent('bursary_fund.updated') as any;
      expect(event).toBeDefined();
      expect(event.data.allocated).toBe(10000);
      expect(event.data.remaining).toBe(40000);
    });

    it('throws NotFoundError when updating a missing fund', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(
        service.update('missing', { totalBudget: 1 } as any, 'user-42', fakeReq),
      ).rejects.toThrow(NotFoundError);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('hard-deletes, audits, and emits bursary_fund.deleted', async () => {
      mockedRepo.getById.mockResolvedValue(fakeFund as any);
      mockedRepo.remove.mockResolvedValue(undefined as any);

      await service.remove('bf-1', 'user-42', fakeReq);

      expect(mockedRepo.remove).toHaveBeenCalledWith('bf-1');
      const event = findEvent('bursary_fund.deleted') as any;
      expect(event).toBeDefined();
      expect(event.data.fundName).toBe('Hardship Bursary 2025/26');
    });

    it('throws NotFoundError if the fund does not exist before deletion', async () => {
      mockedRepo.getById.mockResolvedValue(null);
      await expect(service.remove('missing', 'user-42', fakeReq)).rejects.toThrow(NotFoundError);
      expect(mockedRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('forwards fundType and academicYear filters', async () => {
      mockedRepo.list.mockResolvedValue({
        data: [],
        pagination: { limit: 25, total: 0, hasNext: false, nextCursor: null },
      } as any);

      await service.list({
        cursor: undefined,
        limit: 25,
        sort: 'createdAt',
        order: 'desc',
        fundType: 'HARDSHIP',
        academicYear: '2025/26',
      });

      expect(mockedRepo.list).toHaveBeenCalledWith(
        { fundType: 'HARDSHIP', academicYear: '2025/26' },
        expect.objectContaining({ limit: 25, sort: 'createdAt', order: 'desc' }),
      );
    });
  });
});
