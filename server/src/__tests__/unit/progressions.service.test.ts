import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ──────────────
vi.mock('../../repositories/progressionRecord.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  findByEnrolmentAndYear: vi.fn(),
}));
vi.mock('../../repositories/enrolment.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../repositories/moduleResult.repository', () => ({
  findForEnrolmentYear: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as progressionsService from '../../api/progressions/progressions.service';
import * as repo from '../../repositories/progressionRecord.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import * as moduleResultRepo from '../../repositories/moduleResult.repository';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedEnrolmentRepo = vi.mocked(enrolmentRepo);
const mockedModuleResultRepo = vi.mocked(moduleResultRepo);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeEnrolment = {
  id: 'enrol-1',
  studentId: 'stu-1',
  programmeId: 'prog-1',
  yearOfStudy: 2,
  programme: { id: 'prog-1', level: 'LEVEL_5', duration: 3, title: 'BSc Test' },
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

describe('progressions.service.decideForEnrolmentYear', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedEnrolmentRepo.getById.mockResolvedValue(fakeEnrolment as any);
    mockedRepo.findByEnrolmentAndYear.mockResolvedValue(null);
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([]);
  });

  it('throws NotFoundError when the enrolment does not exist', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue(null);
    await expect(
      progressionsService.decideForEnrolmentYear('missing', '2025/26', {}, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('returns a preview decision and emits progressions.decided without persisting', async () => {
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([
      { id: 'mr-1', moduleId: 'm-1', credits: 30, level: 5, aggregateMark: 65, grade: null, status: 'CONFIRMED' },
      { id: 'mr-2', moduleId: 'm-2', credits: 30, level: 5, aggregateMark: 70, grade: null, status: 'CONFIRMED' },
      { id: 'mr-3', moduleId: 'm-3', credits: 30, level: 5, aggregateMark: 55, grade: null, status: 'CONFIRMED' },
      { id: 'mr-4', moduleId: 'm-4', credits: 30, level: 5, aggregateMark: 60, grade: null, status: 'CONFIRMED' },
    ] as any);

    const result = await progressionsService.decideForEnrolmentYear(
      'enrol-1',
      '2025/26',
      {},
      'user-1',
      fakeReq,
    );

    expect(result.decision).toBe('PROGRESS');
    expect(result.totalCreditsAttempted).toBe(120);
    expect(result.totalCreditsPassed).toBe(120);
    expect(result.persisted).toBe(false);
    expect(result.progressionRecordId).toBeNull();
    expect(mockedRepo.create).not.toHaveBeenCalled();
    expect(mockedRepo.update).not.toHaveBeenCalled();

    const events = mockedEmitEvent.mock.calls.map((c) => (typeof c[0] === 'object' ? c[0] : null));
    const decided = events.find((e) => e && e.event === 'progressions.decided');
    expect(decided).toBeDefined();
    expect(decided?.data).toEqual(
      expect.objectContaining({
        decision: 'PROGRESS',
        totalCreditsAttempted: 120,
        totalCreditsPassed: 120,
        persisted: false,
      }),
    );
  });

  it('treats CONFIRMED + aggregateMark >= passMark as a pass', async () => {
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([
      { id: 'mr-1', moduleId: 'm-1', credits: 30, level: 5, aggregateMark: 41, grade: null, status: 'CONFIRMED' },
      { id: 'mr-2', moduleId: 'm-2', credits: 30, level: 5, aggregateMark: 39, grade: null, status: 'CONFIRMED' },
    ] as any);
    const result = await progressionsService.decideForEnrolmentYear(
      'enrol-1',
      '2025/26',
      {},
      'user-1',
      fakeReq,
    );
    expect(result.totalCreditsPassed).toBe(30);
    expect(result.failedModuleIds).toEqual(['m-2']);
  });

  it('treats CONFIRMED + null aggregateMark + passing grade as a pass (fallback)', async () => {
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([
      { id: 'mr-1', moduleId: 'm-1', credits: 30, level: 5, aggregateMark: null, grade: 'PASS', status: 'CONFIRMED' },
      { id: 'mr-2', moduleId: 'm-2', credits: 30, level: 5, aggregateMark: null, grade: null, status: 'CONFIRMED' },
    ] as any);
    const result = await progressionsService.decideForEnrolmentYear(
      'enrol-1',
      '2025/26',
      {},
      'user-1',
      fakeReq,
    );
    expect(result.totalCreditsPassed).toBe(30);
  });

  it('treats non-CONFIRMED rows as fails (cannot rely on unratified marks)', async () => {
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([
      { id: 'mr-1', moduleId: 'm-1', credits: 30, level: 5, aggregateMark: 70, grade: null, status: 'PROVISIONAL' },
      { id: 'mr-2', moduleId: 'm-2', credits: 30, level: 5, aggregateMark: 70, grade: null, status: 'CONFIRMED' },
    ] as any);
    const result = await progressionsService.decideForEnrolmentYear(
      'enrol-1',
      '2025/26',
      {},
      'user-1',
      fakeReq,
    );
    expect(result.totalCreditsPassed).toBe(30);
    expect(result.failedModuleIds).toEqual(['m-1']);
  });

  it('persists a new ProgressionRecord when persist:true and no existing row', async () => {
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([
      { id: 'mr-1', moduleId: 'm-1', credits: 60, level: 5, aggregateMark: 65, grade: null, status: 'CONFIRMED' },
      { id: 'mr-2', moduleId: 'm-2', credits: 60, level: 5, aggregateMark: 70, grade: null, status: 'CONFIRMED' },
    ] as any);
    mockedRepo.create.mockResolvedValue({ id: 'pr-new', enrolmentId: 'enrol-1', progressionDecision: 'PROGRESS' } as any);

    const result = await progressionsService.decideForEnrolmentYear(
      'enrol-1',
      '2025/26',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        enrolmentId: 'enrol-1',
        academicYear: '2025/26',
        yearOfStudy: 2,
        progressionDecision: 'PROGRESS',
        totalCreditsPassed: 120,
      }),
    );
    expect(result.persisted).toBe(true);
    expect(result.progressionRecordId).toBe('pr-new');
  });

  it('updates an existing ProgressionRecord on re-decision (idempotent persist)', async () => {
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([
      { id: 'mr-1', moduleId: 'm-1', credits: 120, level: 5, aggregateMark: 65, grade: null, status: 'CONFIRMED' },
    ] as any);
    mockedRepo.findByEnrolmentAndYear.mockResolvedValue({ id: 'pr-existing', enrolmentId: 'enrol-1' } as any);
    mockedRepo.getById.mockResolvedValue({ id: 'pr-existing', enrolmentId: 'enrol-1', progressionDecision: 'REPEAT_MODULES' } as any);
    mockedRepo.update.mockResolvedValue({ id: 'pr-existing', enrolmentId: 'enrol-1', progressionDecision: 'PROGRESS' } as any);

    const result = await progressionsService.decideForEnrolmentYear(
      'enrol-1',
      '2025/26',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(mockedRepo.update).toHaveBeenCalledWith(
      'pr-existing',
      expect.objectContaining({ progressionDecision: 'PROGRESS' }),
    );
    expect(mockedRepo.create).not.toHaveBeenCalled();
    expect(result.progressionRecordId).toBe('pr-existing');
  });

  it('rejects persist:true on an empty-year input without force', async () => {
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([]);
    await expect(
      progressionsService.decideForEnrolmentYear(
        'enrol-1',
        '2025/26',
        { persist: true },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.create).not.toHaveBeenCalled();
  });

  it('detects final year when yearOfStudy >= programme duration → AWARD', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue({
      ...fakeEnrolment,
      yearOfStudy: 3,
      programme: { ...fakeEnrolment.programme, level: 'LEVEL_6', duration: 3 },
    } as any);
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([
      { id: 'mr-1', moduleId: 'm-1', credits: 60, level: 6, aggregateMark: 65, grade: null, status: 'CONFIRMED' },
      { id: 'mr-2', moduleId: 'm-2', credits: 60, level: 6, aggregateMark: 70, grade: null, status: 'CONFIRMED' },
    ] as any);

    const result = await progressionsService.decideForEnrolmentYear(
      'enrol-1',
      '2025/26',
      {},
      'user-1',
      fakeReq,
    );
    expect(result.decision).toBe('AWARD');
    expect(result.isFinalYear).toBe(true);
  });

  it('audits and forwards passMark / force to the event payload', async () => {
    mockedModuleResultRepo.findForEnrolmentYear.mockResolvedValue([
      { id: 'mr-1', moduleId: 'm-1', credits: 60, level: 5, aggregateMark: 60, grade: null, status: 'CONFIRMED' },
      { id: 'mr-2', moduleId: 'm-2', credits: 60, level: 5, aggregateMark: 65, grade: null, status: 'CONFIRMED' },
    ] as any);
    mockedRepo.create.mockResolvedValue({ id: 'pr-new' } as any);

    await progressionsService.decideForEnrolmentYear(
      'enrol-1',
      '2025/26',
      { persist: true, force: true, passMark: 50 },
      'user-1',
      fakeReq,
    );

    expect(mockedLogAudit).toHaveBeenCalledWith(
      'Enrolment',
      'enrol-1',
      'UPDATE',
      'user-1',
      null,
      expect.objectContaining({ academicYear: '2025/26', persisted: true }),
      fakeReq,
    );

    const events = mockedEmitEvent.mock.calls.map((c) => (typeof c[0] === 'object' ? c[0] : null));
    const decided = events.find((e) => e && e.event === 'progressions.decided');
    expect(decided?.data).toEqual(
      expect.objectContaining({ passMark: 50, force: true, persisted: true }),
    );
  });
});
