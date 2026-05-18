import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

vi.mock('../../repositories/awardRecord.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  findByEnrolment: vi.fn(),
}));
vi.mock('../../repositories/enrolment.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../repositories/moduleResult.repository', () => ({
  findForEnrolment: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as awardsService from '../../api/awards/awards.service';
import * as repo from '../../repositories/awardRecord.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import * as moduleResultRepo from '../../repositories/moduleResult.repository';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedEnrolmentRepo = vi.mocked(enrolmentRepo);
const mockedModuleResultRepo = vi.mocked(moduleResultRepo);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeEnrolment = {
  id: 'enrol-1',
  studentId: 'stu-1',
  programmeId: 'prog-1',
  yearOfStudy: 3,
  programme: { id: 'prog-1', level: 'LEVEL_6', duration: 3, title: 'BSc Test (Hons)' },
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

describe('awards.service.classifyForEnrolment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedEnrolmentRepo.getById.mockResolvedValue(fakeEnrolment as any);
    mockedRepo.findByEnrolment.mockResolvedValue(null);
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([]);
  });

  it('throws NotFoundError when the enrolment does not exist', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue(null);
    await expect(
      awardsService.classifyForEnrolment('missing', {}, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('returns a preview classification for a UG honours enrolment without persisting', async () => {
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'a', moduleId: 'a', credits: 60, level: 6, aggregateMark: 75, grade: null, status: 'CONFIRMED', academicYear: '2025/26' },
      { id: 'b', moduleId: 'b', credits: 60, level: 6, aggregateMark: 65, grade: null, status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);

    const result = await awardsService.classifyForEnrolment('enrol-1', {}, 'user-1', fakeReq);

    expect(result.classification).toBe('FIRST');
    expect(result.finalAverage).toBe(70);
    expect(result.persisted).toBe(false);
    expect(result.awardRecordId).toBeNull();
    expect(mockedRepo.create).not.toHaveBeenCalled();

    const events = mockedEmitEvent.mock.calls.map((c) => (typeof c[0] === 'object' ? c[0] : null));
    expect(events.find((e) => e?.event === 'awards.classified')).toBeDefined();
  });

  it('only considers CONFIRMED ModuleResults (filter passed to the repo)', async () => {
    await awardsService.classifyForEnrolment('enrol-1', {}, 'user-1', fakeReq);
    expect(mockedModuleResultRepo.findForEnrolment).toHaveBeenCalledWith('enrol-1', {
      statuses: ['CONFIRMED'],
    });
  });

  it('persists a new AwardRecord when persist:true and no existing row', async () => {
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'a', moduleId: 'a', credits: 120, level: 6, aggregateMark: 65, grade: null, status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);
    mockedRepo.create.mockResolvedValue({ id: 'aw-new', studentId: 'stu-1' } as any);

    const result = await awardsService.classifyForEnrolment(
      'enrol-1',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'stu-1',
        enrolmentId: 'enrol-1',
        programmeId: 'prog-1',
        awardTitle: 'BSc Test (Hons)',
        classification: 'UPPER_SECOND',
        status: 'RECOMMENDED',
      }),
    );
    expect(result.persisted).toBe(true);
    expect(result.awardRecordId).toBe('aw-new');
  });

  it('updates an existing AwardRecord on re-classification (idempotent persist)', async () => {
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'a', moduleId: 'a', credits: 120, level: 6, aggregateMark: 75, grade: null, status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);
    mockedRepo.findByEnrolment.mockResolvedValue({ id: 'aw-existing', enrolmentId: 'enrol-1', studentId: 'stu-1' } as any);
    mockedRepo.getById.mockResolvedValue({ id: 'aw-existing', enrolmentId: 'enrol-1', studentId: 'stu-1', programmeId: 'prog-1', classification: 'UPPER_SECOND' } as any);
    mockedRepo.update.mockResolvedValue({ id: 'aw-existing', studentId: 'stu-1', programmeId: 'prog-1', classification: 'FIRST' } as any);

    const result = await awardsService.classifyForEnrolment(
      'enrol-1',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(mockedRepo.update).toHaveBeenCalledWith(
      'aw-existing',
      expect.objectContaining({ classification: 'FIRST' }),
    );
    expect(mockedRepo.create).not.toHaveBeenCalled();
    expect(result.awardRecordId).toBe('aw-existing');
  });

  it('rejects persist:true when no contributing module has an aggregateMark (without force)', async () => {
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'a', moduleId: 'a', credits: 120, level: 6, aggregateMark: null, grade: null, status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);
    await expect(
      awardsService.classifyForEnrolment('enrol-1', { persist: true }, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.create).not.toHaveBeenCalled();
  });

  it('refuses to classify a doctoral programme (LEVEL_8) and returns FAIL', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue({
      ...fakeEnrolment,
      programme: { ...fakeEnrolment.programme, level: 'LEVEL_8' },
    } as any);
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'a', moduleId: 'a', credits: 360, level: 8, aggregateMark: 85, grade: null, status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);

    const result = await awardsService.classifyForEnrolment('enrol-1', {}, 'user-1', fakeReq);
    expect(result.classification).toBe('FAIL');
    expect(result.reason).toMatch(/doctoral/i);
  });
});
