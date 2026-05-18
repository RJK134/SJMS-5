import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

vi.mock('../../repositories/transcript.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  createWithLines: vi.fn(),
}));
vi.mock('../../repositories/student.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../repositories/enrolment.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../repositories/moduleResult.repository', () => ({
  findForEnrolment: vi.fn(),
}));
vi.mock('../../repositories/awardRecord.repository', () => ({
  findByEnrolment: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as transcriptsService from '../../api/transcripts/transcripts.service';
import * as repo from '../../repositories/transcript.repository';
import * as studentRepo from '../../repositories/student.repository';
import * as enrolmentRepo from '../../repositories/enrolment.repository';
import * as moduleResultRepo from '../../repositories/moduleResult.repository';
import * as awardRecordRepo from '../../repositories/awardRecord.repository';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedStudentRepo = vi.mocked(studentRepo);
const mockedEnrolmentRepo = vi.mocked(enrolmentRepo);
const mockedModuleResultRepo = vi.mocked(moduleResultRepo);
const mockedAwardRecordRepo = vi.mocked(awardRecordRepo);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeStudent = {
  id: 'stu-1',
  studentNumber: 'STU-2025-00001',
  person: { firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: new Date('1815-12-10') },
  enrolments: [
    { id: 'enrol-1', programmeId: 'prog-1', status: 'ENROLLED', createdAt: new Date('2024-09-01') },
  ],
};

const fakeEnrolmentDetail = {
  id: 'enrol-1',
  programme: {
    id: 'prog-1',
    programmeCode: 'BSC-CS-001',
    title: 'BSc (Hons) Computer Science',
    level: 'LEVEL_6',
    awardingBody: 'Future Horizons Education',
  },
  moduleRegistrations: [
    { moduleId: 'mod-a', module: { moduleCode: 'CS101', title: 'Foundations of Computing' } },
    { moduleId: 'mod-b', module: { moduleCode: 'CS201', title: 'Data Structures' } },
  ],
};

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as any;

describe('transcripts.service.composeForStudent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedStudentRepo.getById.mockResolvedValue(fakeStudent as any);
    mockedEnrolmentRepo.getById.mockResolvedValue(fakeEnrolmentDetail as any);
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([]);
    mockedAwardRecordRepo.findByEnrolment.mockResolvedValue(null);
  });

  it('throws NotFoundError when the student does not exist', async () => {
    mockedStudentRepo.getById.mockResolvedValue(null);
    await expect(
      transcriptsService.composeForStudent('missing', {}, 'user-1', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when the student has no enrolment', async () => {
    mockedStudentRepo.getById.mockResolvedValue({ ...fakeStudent, enrolments: [] } as any);
    await expect(
      transcriptsService.composeForStudent('stu-1', {}, 'user-1', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('returns a preview composition with the canonical INTERIM type by default', async () => {
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'mr-1', moduleId: 'mod-a', credits: 30, level: 6, aggregateMark: 70, grade: 'B', status: 'CONFIRMED', academicYear: '2025/26' },
      { id: 'mr-2', moduleId: 'mod-b', credits: 30, level: 6, aggregateMark: 60, grade: 'C', status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);

    const result = await transcriptsService.composeForStudent(
      'stu-1',
      {},
      'user-1',
      fakeReq,
    );

    expect(result.composition.header.transcriptType).toBe('INTERIM');
    expect(result.composition.header.studentNumber).toBe('STU-2025-00001');
    expect(result.composition.header.programmeTitle).toBe('BSc (Hons) Computer Science');
    expect(result.composition.lines).toHaveLength(2);
    expect(result.composition.lines.map((l) => l.moduleCode)).toEqual(['CS101', 'CS201']);
    expect(result.composition.totals.finalAverage).toBe(65);
    expect(result.persisted).toBe(false);
    expect(result.transcriptId).toBeNull();
    expect(mockedRepo.createWithLines).not.toHaveBeenCalled();

    const events = mockedEmitEvent.mock.calls.map((c) => (typeof c[0] === 'object' ? c[0] : null));
    expect(events.find((e) => e?.event === 'transcripts.composed')).toBeDefined();
  });

  it('only loads CONFIRMED ModuleResults (filter passed to the repo)', async () => {
    await transcriptsService.composeForStudent('stu-1', {}, 'user-1', fakeReq);
    expect(mockedModuleResultRepo.findForEnrolment).toHaveBeenCalledWith('enrol-1', {
      statuses: ['CONFIRMED'],
    });
  });

  it('falls back to a placeholder module title when registration metadata is missing', async () => {
    mockedEnrolmentRepo.getById.mockResolvedValue({
      ...fakeEnrolmentDetail,
      moduleRegistrations: [],
    } as any);
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'mr-1', moduleId: 'mod-a', credits: 30, level: 6, aggregateMark: 70, grade: 'B', status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);

    const result = await transcriptsService.composeForStudent('stu-1', {}, 'user-1', fakeReq);
    expect(result.composition.lines[0].moduleTitle).toBe('(module title unavailable)');
    // The composer falls back to the moduleId as the displayed code when none is found.
    expect(result.composition.lines[0].moduleCode).toBe('mod-a');
  });

  it('persists a Transcript + TranscriptLine row set when persist:true', async () => {
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'mr-1', moduleId: 'mod-a', credits: 60, level: 6, aggregateMark: 70, grade: 'B', status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);
    mockedRepo.createWithLines.mockResolvedValue({ id: 'tr-new', lines: [{}] } as any);

    const result = await transcriptsService.composeForStudent(
      'stu-1',
      { persist: true },
      'user-1',
      fakeReq,
    );

    expect(mockedRepo.createWithLines).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'stu-1',
        transcriptType: 'INTERIM',
        generatedBy: 'user-1',
      }),
      expect.arrayContaining([
        expect.objectContaining({ moduleCode: 'CS101', credits: 60 }),
      ]),
    );
    expect(result.persisted).toBe(true);
    expect(result.transcriptId).toBe('tr-new');
  });

  it('refuses to persist a FINAL transcript without an AwardRecord', async () => {
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'mr-1', moduleId: 'mod-a', credits: 120, level: 6, aggregateMark: 70, grade: 'B', status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);
    mockedAwardRecordRepo.findByEnrolment.mockResolvedValue(null);

    await expect(
      transcriptsService.composeForStudent(
        'stu-1',
        { persist: true, transcriptType: 'FINAL' },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.createWithLines).not.toHaveBeenCalled();
  });

  it('persists a FINAL transcript when an AwardRecord exists with non-REVOKED status', async () => {
    mockedModuleResultRepo.findForEnrolment.mockResolvedValue([
      { id: 'mr-1', moduleId: 'mod-a', credits: 120, level: 6, aggregateMark: 70, grade: 'B', status: 'CONFIRMED', academicYear: '2025/26' },
    ] as any);
    mockedAwardRecordRepo.findByEnrolment.mockResolvedValue({
      id: 'aw-1',
      awardTitle: 'BSc (Hons) Computer Science',
      classification: 'UPPER_SECOND',
      finalAverage: 70,
      awardDate: new Date('2026-07-12'),
      status: 'RECOMMENDED',
    } as any);
    mockedRepo.createWithLines.mockResolvedValue({ id: 'tr-final', lines: [{}] } as any);

    const result = await transcriptsService.composeForStudent(
      'stu-1',
      { persist: true, transcriptType: 'FINAL' },
      'user-1',
      fakeReq,
    );

    expect(result.persisted).toBe(true);
    expect(result.composition.isFinal).toBe(true);
    expect(result.composition.award?.classification).toBe('UPPER_SECOND');
  });

  it('respects an explicit enrolmentId option', async () => {
    mockedStudentRepo.getById.mockResolvedValue({
      ...fakeStudent,
      enrolments: [
        { id: 'enrol-old', programmeId: 'prog-old', status: 'COMPLETED' },
        { id: 'enrol-1', programmeId: 'prog-1', status: 'ENROLLED' },
      ],
    } as any);

    await transcriptsService.composeForStudent(
      'stu-1',
      { enrolmentId: 'enrol-1' },
      'user-1',
      fakeReq,
    );

    expect(mockedEnrolmentRepo.getById).toHaveBeenCalledWith('enrol-1');
    expect(mockedModuleResultRepo.findForEnrolment).toHaveBeenCalledWith('enrol-1', {
      statuses: ['CONFIRMED'],
    });
  });

  it('rejects when the supplied enrolmentId is not on the student', async () => {
    await expect(
      transcriptsService.composeForStudent(
        'stu-1',
        { enrolmentId: 'unrelated' },
        'user-1',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
  });
});
