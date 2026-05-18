import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/feeAssessment.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findLatestByEnrolment: vi.fn(),
}));
vi.mock('../../repositories/enrolment.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../repositories/bursaryApplication.repository', () => ({
  findAwardedByStudent: vi.fn(),
}));
vi.mock('../../repositories/sponsorAgreement.repository', () => ({
  findActiveByStudentYear: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as feeService from '../../api/fee-assessments/fee-assessments.service';
import * as repo from '../../repositories/feeAssessment.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import * as bursaryRepo from '../../repositories/bursaryApplication.repository';
import * as sponsorRepo from '../../repositories/sponsorAgreement.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedEnrolmentRepo = vi.mocked(enrolmentRepo);
const mockedBursaryRepo = vi.mocked(bursaryRepo);
const mockedSponsorRepo = vi.mocked(sponsorRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeEnrolment = {
  id: 'enrol-1',
  studentId: 'stu-1',
  programmeId: 'prog-1',
  academicYear: '2025/26',
  yearOfStudy: 1,
  feeStatus: 'HOME',
  modeOfStudy: 'FULL_TIME',
  programme: {
    id: 'prog-1',
    level: 'LEVEL_4',
    creditTotal: 120,
    title: 'BSc Test',
  },
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

describe('feeAssessments.service.assessForEnrolment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedEnrolmentRepo.getById.mockResolvedValue(fakeEnrolment as any);
    mockedBursaryRepo.findAwardedByStudent.mockResolvedValue([] as any);
    mockedSponsorRepo.findActiveByStudentYear.mockResolvedValue([] as any);
    mockedRepo.findLatestByEnrolment.mockResolvedValue(null);
  });

  it('throws NotFoundError when the enrolment does not exist', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue(null);
    await expect(
      feeService.assessForEnrolment('missing', {}, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when the programme has no level', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue({
      ...fakeEnrolment,
      programme: { ...fakeEnrolment.programme, level: undefined },
    } as any);
    await expect(
      feeService.assessForEnrolment('enrol-1', {}, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when the programme has no creditTotal and no override is supplied', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue({
      ...fakeEnrolment,
      programme: { ...fakeEnrolment.programme, creditTotal: undefined },
    } as any);
    await expect(
      feeService.assessForEnrolment('enrol-1', {}, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('returns a preview outcome and emits fee_assessment.calculated without persisting', async () => {
    const result = await feeService.assessForEnrolment(
      'enrol-1',
      {},
      'user-1',
      fakeReq,
    );

    expect(result.totalFee).toBe(9240); // HOME L4 FT 120 credits
    expect(result.discountAmount).toBe(0);
    expect(result.finalFee).toBe(9240);
    expect(result.persisted).toBe(false);
    expect(result.feeAssessmentId).toBeNull();
    expect(mockedRepo.create).not.toHaveBeenCalled();
    expect(mockedRepo.update).not.toHaveBeenCalled();

    const calculated = findEvent('fee_assessment.calculated');
    expect(calculated).toBeDefined();
    expect(calculated?.data).toEqual(
      expect.objectContaining({
        enrolmentId: 'enrol-1',
        feeStatus: 'HOME',
        modeOfStudy: 'FULL_TIME',
        totalFee: 9240,
        discountAmount: 0,
        finalFee: 9240,
        persisted: false,
      }),
    );
  });

  it('honours an explicit creditsTaken override over the programme creditTotal', async () => {
    const result = await feeService.assessForEnrolment(
      'enrol-1',
      { creditsTaken: 60 },
      'user-1',
      fakeReq,
    );
    expect(result.totalFee).toBe(4620); // 77 × 60 × 1.0
    expect(result.breakdown.creditsTaken).toBe(60);
  });

  it('subtracts awarded bursaries and active sponsor contributions from the fee', async () => {
    mockedBursaryRepo.findAwardedByStudent.mockResolvedValue([
      { id: 'bur-1', awardAmount: 1000 },
      { id: 'bur-2', awardAmount: '500.00' },
    ] as any);
    mockedSponsorRepo.findActiveByStudentYear.mockResolvedValue([
      { id: 'sp-1', amountAgreed: 2000 },
    ] as any);

    const result = await feeService.assessForEnrolment(
      'enrol-1',
      {},
      'user-1',
      fakeReq,
    );

    expect(result.discountAmount).toBe(3500); // 1000 + 500 + 2000
    expect(result.finalFee).toBe(9240 - 3500);
    expect(result.bursaryReferences).toEqual(['bur-1', 'bur-2']);
    expect(result.sponsorReferences).toEqual(['sp-1']);
  });

  it('passes the (studentId, academicYear) filter through to the bursary and sponsor repos', async () => {
    await feeService.assessForEnrolment('enrol-1', {}, 'user-1', fakeReq);
    expect(mockedBursaryRepo.findAwardedByStudent).toHaveBeenCalledWith('stu-1', '2025/26');
    expect(mockedSponsorRepo.findActiveByStudentYear).toHaveBeenCalledWith('stu-1', '2025/26');
  });

  it('refuses to persist when totalFee is zero unless force is true', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue({
      ...fakeEnrolment,
      programme: { ...fakeEnrolment.programme, creditTotal: 0 },
    } as any);
    await expect(
      feeService.assessForEnrolment('enrol-1', { persist: true, creditsTaken: 0 }, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('persists by creating a new FeeAssessment when no prior assessment exists', async () => {
    mockedRepo.findLatestByEnrolment.mockResolvedValue(null);
    mockedRepo.create.mockResolvedValue({
      id: 'fa-new',
      enrolmentId: 'enrol-1',
      feeStatus: 'HOME',
      totalFee: 9240,
      finalFee: 9240,
    } as any);

    const result = await feeService.assessForEnrolment(
      'enrol-1',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(mockedRepo.create).toHaveBeenCalledTimes(1);
    expect(mockedRepo.update).not.toHaveBeenCalled();
    expect(result.persisted).toBe(true);
    expect(result.feeAssessmentId).toBe('fa-new');
    // The CREATE path emits both fee_assessment.created and fee_assessment.calculated.
    expect(findEvent('fee_assessment.created')).toBeDefined();
    expect(findEvent('fee_assessment.calculated')).toBeDefined();
  });

  it('persists by updating the existing FeeAssessment when one is found (idempotent re-run)', async () => {
    mockedRepo.findLatestByEnrolment.mockResolvedValue({
      id: 'fa-existing',
      enrolmentId: 'enrol-1',
      feeStatus: 'HOME',
      totalFee: 9000,
      discountAmount: 0,
      finalFee: 9000,
    } as any);
    mockedRepo.getById.mockResolvedValue({
      id: 'fa-existing',
      enrolmentId: 'enrol-1',
      feeStatus: 'HOME',
      totalFee: 9000,
      discountAmount: 0,
      finalFee: 9000,
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'fa-existing',
      enrolmentId: 'enrol-1',
      feeStatus: 'HOME',
      totalFee: 9240,
      discountAmount: 0,
      finalFee: 9240,
    } as any);

    const result = await feeService.assessForEnrolment(
      'enrol-1',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(mockedRepo.update).toHaveBeenCalledWith(
      'fa-existing',
      expect.objectContaining({
        feeStatus: 'HOME',
        totalFee: 9240,
        discountAmount: 0,
        finalFee: 9240,
      }),
    );
    expect(mockedRepo.create).not.toHaveBeenCalled();
    expect(result.feeAssessmentId).toBe('fa-existing');
    // The UPDATE path emits fee_assessment.updated and fee_assessment.calculated.
    expect(findEvent('fee_assessment.updated')).toBeDefined();
    expect(findEvent('fee_assessment.calculated')).toBeDefined();
  });

  it('creates a brand-new historical FeeAssessment row when force=true even if one already exists', async () => {
    mockedRepo.findLatestByEnrolment.mockResolvedValue({
      id: 'fa-existing',
      totalFee: 9000,
    } as any);
    mockedRepo.create.mockResolvedValue({
      id: 'fa-new-history',
      enrolmentId: 'enrol-1',
      feeStatus: 'HOME',
      totalFee: 9240,
      finalFee: 9240,
    } as any);

    const result = await feeService.assessForEnrolment(
      'enrol-1',
      { persist: true, force: true },
      'user-1',
      fakeReq,
    );

    expect(mockedRepo.create).toHaveBeenCalledTimes(1);
    expect(mockedRepo.update).not.toHaveBeenCalled();
    expect(result.feeAssessmentId).toBe('fa-new-history');

    const calculated = findEvent('fee_assessment.calculated');
    expect(calculated?.data).toEqual(expect.objectContaining({ force: true }));
  });

  it('forwards rule overrides to the pure utility', async () => {
    const result = await feeService.assessForEnrolment(
      'enrol-1',
      {
        rules: { perCreditRates: { HOME: { LEVEL_4: 100 } } },
      },
      'user-1',
      fakeReq,
    );
    expect(result.totalFee).toBe(12000); // 100 × 120 × 1.0
    expect(result.effectiveRules.perCreditRate).toBe(100);
  });

  it('writes an Enrolment-subject audit entry capturing the cohort-level outcome', async () => {
    await feeService.assessForEnrolment('enrol-1', {}, 'user-1', fakeReq);
    expect(mockedLogAudit).toHaveBeenCalledWith(
      'Enrolment',
      'enrol-1',
      'UPDATE',
      'user-1',
      null,
      expect.objectContaining({
        academicYear: '2025/26',
        feeStatus: 'HOME',
        totalFee: 9240,
        finalFee: 9240,
        persisted: false,
      }),
      fakeReq,
    );
  });
});

describe('feeAssessments.service.create / update / getById', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('getById throws NotFoundError when the row does not exist', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(feeService.getById('missing')).rejects.toThrow(NotFoundError);
  });

  it('create audits and emits fee_assessment.created', async () => {
    mockedRepo.create.mockResolvedValue({
      id: 'fa-1',
      enrolmentId: 'enrol-1',
      feeStatus: 'OVERSEAS',
      totalFee: 17520,
      finalFee: 17520,
    } as any);

    const result = await feeService.create(
      {
        enrolmentId: 'enrol-1',
        feeStatus: 'OVERSEAS',
        assessedDate: new Date(),
        totalFee: 17520,
        finalFee: 17520,
      } as any,
      'user-1',
      fakeReq,
    );

    expect(result.id).toBe('fa-1');
    expect(mockedLogAudit).toHaveBeenCalledWith(
      'FeeAssessment',
      'fa-1',
      'CREATE',
      'user-1',
      null,
      expect.any(Object),
      fakeReq,
    );
    expect(findEvent('fee_assessment.created')).toBeDefined();
  });

  it('update reads the previous row, audits, and emits fee_assessment.updated', async () => {
    mockedRepo.getById.mockResolvedValue({
      id: 'fa-1',
      enrolmentId: 'enrol-1',
      feeStatus: 'HOME',
      totalFee: 9000,
      finalFee: 9000,
    } as any);
    mockedRepo.update.mockResolvedValue({
      id: 'fa-1',
      enrolmentId: 'enrol-1',
      feeStatus: 'HOME',
      totalFee: 9240,
      finalFee: 9240,
    } as any);

    await feeService.update('fa-1', { totalFee: 9240 } as any, 'user-1', fakeReq);

    expect(mockedRepo.getById).toHaveBeenCalledWith('fa-1');
    expect(mockedRepo.update).toHaveBeenCalledWith('fa-1', { totalFee: 9240 });
    expect(mockedLogAudit).toHaveBeenCalledWith(
      'FeeAssessment',
      'fa-1',
      'UPDATE',
      'user-1',
      expect.objectContaining({ id: 'fa-1', totalFee: 9000 }),
      expect.objectContaining({ id: 'fa-1', totalFee: 9240 }),
      fakeReq,
    );
    expect(findEvent('fee_assessment.updated')).toBeDefined();
  });
});
