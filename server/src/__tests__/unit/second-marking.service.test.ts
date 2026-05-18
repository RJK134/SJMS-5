import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../utils/errors';

// ── Mock dependencies before importing the service under test ───────────────
vi.mock('../../repositories/secondMarkingRecord.repository', () => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findByAttempt: vi.fn(),
  findOpenAssignmentsForMarker: vi.fn(),
}));
vi.mock('../../repositories/assessmentAttempt.repository', () => ({
  getById: vi.fn(),
}));
vi.mock('../../api/marks/marks.service', () => ({
  list: vi.fn(),
  update: vi.fn(),
}));
vi.mock('../../utils/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../utils/webhooks', () => ({ emitEvent: vi.fn() }));

import * as service from '../../api/marks/second-marking.service';
import * as repo from '../../repositories/secondMarkingRecord.repository';
import * as attemptRepo from '../../repositories/assessmentAttempt.repository';
import * as marksService from '../../api/marks/marks.service';
import { logAudit } from '../../utils/audit';
import { emitEvent } from '../../utils/webhooks';

const mockedRepo = vi.mocked(repo);
const mockedAttemptRepo = vi.mocked(attemptRepo);
const mockedMarksService = vi.mocked(marksService);
const mockedLogAudit = vi.mocked(logAudit);
const mockedEmitEvent = vi.mocked(emitEvent);

const fakeReq = { ip: '127.0.0.1', user: {}, get: vi.fn() } as unknown as Parameters<typeof service.assignSecondMarker>[3];

const findEvent = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .find((e) => e && (e as { event?: string }).event === eventName);

const findAllEvents = (eventName: string) =>
  mockedEmitEvent.mock.calls
    .map((c) => (typeof c[0] === 'object' ? c[0] : null))
    .filter((e) => e && (e as { event?: string }).event === eventName);

const fakeAttempt = {
  id: 'attempt-1',
  assessmentId: 'assess-1',
  moduleRegistrationId: 'mr-1',
  rawMark: 65,
  moderatedMark: null,
  finalMark: null,
  grade: null,
  status: 'MARKED',
  markedDate: new Date('2026-04-01'),
  markedBy: 'first-marker-user',
  moderatedDate: null,
  moderatedBy: null,
  feedback: null,
  hasExtenuatingCircumstances: false,
  attemptNumber: 1,
  submittedDate: new Date('2026-03-25'),
  createdAt: new Date('2026-03-25'),
  updatedAt: new Date('2026-04-01'),
  deletedAt: null,
  moduleRegistration: {
    id: 'mr-1',
    enrolment: { id: 'enr-1', studentId: 'student-1' },
  },
};

const baseRecord = {
  id: 'smr-1',
  assessmentId: 'assess-1',
  studentId: 'student-1',
  firstMarkerMark: 65,
  secondMarkerMark: 65, // placeholder echoes firstMarkerMark on assignment
  agreedMark: null,
  secondMarkerId: 'second-marker-user',
  completedDate: null,
  createdAt: new Date('2026-04-02T10:00:00Z'),
  updatedAt: new Date('2026-04-02T10:00:00Z'),
  createdBy: 'admissions-officer',
  updatedBy: 'admissions-officer',
};

describe('secondMarkingService.assignSecondMarker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAttemptRepo.getById.mockResolvedValue(fakeAttempt as unknown as Awaited<ReturnType<typeof attemptRepo.getById>>);
    mockedRepo.findByAttempt.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof repo.findByAttempt>>);
    mockedRepo.create.mockResolvedValue(baseRecord as unknown as Awaited<ReturnType<typeof repo.create>>);
  });

  it('happy path: creates a SecondMarkingRecord, emits second_marking.assigned, and audits', async () => {
    const result = await service.assignSecondMarker(
      'attempt-1',
      { secondMarkerId: 'second-marker-user' },
      'admissions-officer',
      fakeReq,
    );
    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: 'assess-1',
        studentId: 'student-1',
        firstMarkerMark: 65,
        secondMarkerMark: 65,
        secondMarkerId: 'second-marker-user',
      }),
    );
    expect(result.derivedStatus).toBe('ASSIGNED_TO_SECOND');

    const assigned = findEvent('second_marking.assigned');
    expect(assigned).toBeDefined();
    expect(assigned?.data).toEqual(
      expect.objectContaining({
        assessmentAttemptId: 'attempt-1',
        assessmentId: 'assess-1',
        studentId: 'student-1',
        secondMarkerId: 'second-marker-user',
        firstMarkerId: 'first-marker-user',
        firstMarkerMark: 65,
        status: 'ASSIGNED_TO_SECOND',
      }),
    );

    expect(mockedLogAudit).toHaveBeenCalledWith(
      'AssessmentAttempt',
      'attempt-1',
      'UPDATE',
      'admissions-officer',
      null,
      expect.objectContaining({ action: 'second_marker_assigned' }),
      fakeReq,
    );
  });

  it('throws NotFoundError when the AssessmentAttempt does not exist', async () => {
    mockedAttemptRepo.getById.mockResolvedValue(null);
    await expect(
      service.assignSecondMarker(
        'missing',
        { secondMarkerId: 'second-marker-user' },
        'admissions-officer',
        fakeReq,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects assignment when the second marker matches the first marker (independence guard)', async () => {
    await expect(
      service.assignSecondMarker(
        'attempt-1',
        { secondMarkerId: 'first-marker-user' },
        'admissions-officer',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects double-assignment for the same (assessment, student) pair without force', async () => {
    mockedRepo.findByAttempt.mockResolvedValue([
      { ...baseRecord, id: 'smr-existing', completedDate: null },
    ] as unknown as Awaited<ReturnType<typeof repo.findByAttempt>>);
    await expect(
      service.assignSecondMarker(
        'attempt-1',
        { secondMarkerId: 'second-marker-user' },
        'admissions-officer',
        fakeReq,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('allows assignment over an existing reconciled record (a fresh resubmission cycle)', async () => {
    mockedRepo.findByAttempt.mockResolvedValue([
      { ...baseRecord, id: 'smr-old', completedDate: new Date('2026-03-01'), agreedMark: 60 },
    ] as unknown as Awaited<ReturnType<typeof repo.findByAttempt>>);
    const result = await service.assignSecondMarker(
      'attempt-1',
      { secondMarkerId: 'second-marker-user' },
      'admissions-officer',
      fakeReq,
    );
    expect(result.derivedStatus).toBe('ASSIGNED_TO_SECOND');
    expect(mockedRepo.create).toHaveBeenCalled();
  });

  it('overrides duplicate-assignment when force:true is supplied', async () => {
    mockedRepo.findByAttempt.mockResolvedValue([
      { ...baseRecord, id: 'smr-existing', completedDate: null },
    ] as unknown as Awaited<ReturnType<typeof repo.findByAttempt>>);
    const result = await service.assignSecondMarker(
      'attempt-1',
      { secondMarkerId: 'second-marker-user', force: true },
      'admissions-officer',
      fakeReq,
    );
    expect(result.derivedStatus).toBe('ASSIGNED_TO_SECOND');
    const assigned = findEvent('second_marking.assigned');
    expect(assigned?.data).toEqual(expect.objectContaining({ force: true }));
  });

  it('initialises secondMarkerMark from the attempt rawMark (or 0 when rawMark is null)', async () => {
    mockedAttemptRepo.getById.mockResolvedValue({ ...fakeAttempt, rawMark: null } as unknown as Awaited<ReturnType<typeof attemptRepo.getById>>);
    await service.assignSecondMarker(
      'attempt-1',
      { secondMarkerId: 'second-marker-user' },
      'admissions-officer',
      fakeReq,
    );
    expect(mockedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ firstMarkerMark: 0, secondMarkerMark: 0 }),
    );
  });
});

describe('secondMarkingService.recordSecondMark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.getById.mockResolvedValue(baseRecord as unknown as Awaited<ReturnType<typeof repo.getById>>);
    mockedRepo.update.mockResolvedValue({
      ...baseRecord,
      secondMarkerMark: 70,
      updatedAt: new Date('2026-04-03T10:00:00Z'),
    } as unknown as Awaited<ReturnType<typeof repo.update>>);
  });

  it('happy path: only the assigned second marker may record (caller must equal secondMarkerId)', async () => {
    const result = await service.recordSecondMark(
      'smr-1',
      { secondMark: 70 },
      'second-marker-user',
      fakeReq,
    );
    expect(mockedRepo.update).toHaveBeenCalledWith(
      'smr-1',
      expect.objectContaining({ secondMarkerMark: 70 }),
    );
    expect(result.derivedStatus).toBe('SECOND_MARKED');

    const recorded = findEvent('second_marking.recorded');
    expect(recorded).toBeDefined();
    expect(recorded?.data).toEqual(
      expect.objectContaining({
        assessmentId: 'assess-1',
        studentId: 'student-1',
        secondMarkerId: 'second-marker-user',
        firstMarkerMark: 65,
        secondMarkerMark: 70,
        status: 'SECOND_MARKED',
      }),
    );

    expect(mockedLogAudit).toHaveBeenCalledWith(
      'SecondMarkingRecord',
      'smr-1',
      'UPDATE',
      'second-marker-user',
      expect.any(Object),
      expect.any(Object),
      fakeReq,
    );
  });

  it('rejects recording by a user other than the assigned second marker (independence at recording time)', async () => {
    await expect(
      service.recordSecondMark('smr-1', { secondMark: 70 }, 'random-user', fakeReq),
    ).rejects.toThrow(ValidationError);
    expect(mockedRepo.update).not.toHaveBeenCalled();
  });

  it('allows non-assigned users to record when force:true (registry override)', async () => {
    const result = await service.recordSecondMark(
      'smr-1',
      { secondMark: 70, force: true },
      'registry-officer',
      fakeReq,
    );
    expect(result.derivedStatus).toBe('SECOND_MARKED');
    const recorded = findEvent('second_marking.recorded');
    expect(recorded?.data).toEqual(expect.objectContaining({ force: true }));
  });

  it('rejects recording against an already-reconciled SecondMarkingRecord', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...baseRecord,
      completedDate: new Date('2026-04-04'),
      agreedMark: 67,
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    await expect(
      service.recordSecondMark('smr-1', { secondMark: 70 }, 'second-marker-user', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError when the SecondMarkingRecord does not exist', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(
      service.recordSecondMark('missing', { secondMark: 70 }, 'second-marker-user', fakeReq),
    ).rejects.toThrow(NotFoundError);
  });

  it('best-effort propagates feedback to the parent attempt without rolling back on propagation failure', async () => {
    mockedMarksService.list.mockResolvedValue({
      data: [{ id: 'attempt-1' }],
      pagination: { limit: 1, total: 1, hasNext: false, nextCursor: null },
    } as unknown as Awaited<ReturnType<typeof marksService.list>>);
    mockedMarksService.update.mockRejectedValueOnce(new Error('boom'));

    // Should NOT throw despite propagation failure.
    const result = await service.recordSecondMark(
      'smr-1',
      { secondMark: 70, feedback: 'Solid analytical chapter.' },
      'second-marker-user',
      fakeReq,
    );
    expect(result.derivedStatus).toBe('SECOND_MARKED');
  });
});

describe('secondMarkingService.reconcileMarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.getById.mockResolvedValue({
      ...baseRecord,
      firstMarkerMark: 65,
      secondMarkerMark: 67,
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    mockedRepo.update.mockImplementation(async (id: string, data: unknown) => ({
      ...baseRecord,
      firstMarkerMark: 65,
      secondMarkerMark: 67,
      ...(data as object),
    } as unknown as Awaited<ReturnType<typeof repo.update>>));
    mockedMarksService.list.mockResolvedValue({
      data: [{ id: 'attempt-1' }],
      pagination: { limit: 1, total: 1, hasNext: false, nextCursor: null },
    } as unknown as Awaited<ReturnType<typeof marksService.list>>);
    mockedMarksService.update.mockResolvedValue({} as unknown as Awaited<ReturnType<typeof marksService.update>>);
  });

  it('auto-reconciles to the average when |firstMark − secondMark| <= tolerance (5pp default)', async () => {
    // 65 vs 67 — difference 2pp, within default 5pp.
    const result = await service.reconcileMarks(
      'smr-1',
      {},
      'registry-officer',
      fakeReq,
    );
    expect(result.requiresThirdMarker).toBe(false);
    expect(result.agreedMark).toBe(66); // (65+67)/2 = 66
    expect(result.withinTolerance).toBe(true);
    expect(result.toleranceThreshold).toBe(5);
    expect(mockedRepo.update).toHaveBeenCalledWith(
      'smr-1',
      expect.objectContaining({ agreedMark: 66 }),
    );

    const reconciled = findEvent('second_marking.reconciled');
    expect(reconciled).toBeDefined();
    expect(reconciled?.data).toEqual(
      expect.objectContaining({
        agreedMark: 66,
        withinTolerance: true,
        autoReconciled: true,
      }),
    );
  });

  it('emits second_marking.requires_third_marker when |firstMark − secondMark| > tolerance', async () => {
    // 50 vs 70 — difference 20pp, outside default 5pp.
    mockedRepo.getById.mockResolvedValue({
      ...baseRecord,
      firstMarkerMark: 50,
      secondMarkerMark: 70,
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    const result = await service.reconcileMarks(
      'smr-1',
      {},
      'registry-officer',
      fakeReq,
    );
    expect(result.requiresThirdMarker).toBe(true);
    expect(result.agreedMark).toBeNull();
    expect(result.withinTolerance).toBe(false);
    expect(mockedRepo.update).not.toHaveBeenCalled();

    const third = findEvent('second_marking.requires_third_marker');
    expect(third).toBeDefined();
    expect(third?.data).toEqual(
      expect.objectContaining({
        firstMarkerMark: 50,
        secondMarkerMark: 70,
        difference: 20,
        toleranceThreshold: 5,
      }),
    );
    expect(findEvent('second_marking.reconciled')).toBeUndefined();
  });

  it('honours an explicit reconciledMark within tolerance (operator-driven)', async () => {
    const result = await service.reconcileMarks(
      'smr-1',
      { reconciledMark: 68 },
      'registry-officer',
      fakeReq,
    );
    expect(result.agreedMark).toBe(68);
    expect(result.requiresThirdMarker).toBe(false);
    expect(mockedRepo.update).toHaveBeenCalledWith(
      'smr-1',
      expect.objectContaining({ agreedMark: 68 }),
    );
  });

  it('rejects an explicit reconciledMark outside tolerance unless force:true', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...baseRecord,
      firstMarkerMark: 50,
      secondMarkerMark: 70,
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    const result = await service.reconcileMarks(
      'smr-1',
      { reconciledMark: 60 }, // operator override but no force
      'registry-officer',
      fakeReq,
    );
    expect(result.requiresThirdMarker).toBe(true);
    expect(result.agreedMark).toBeNull();
    expect(mockedRepo.update).not.toHaveBeenCalled();
  });

  it('accepts an out-of-tolerance reconciledMark when force:true', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...baseRecord,
      firstMarkerMark: 50,
      secondMarkerMark: 70,
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    const result = await service.reconcileMarks(
      'smr-1',
      { reconciledMark: 60, force: true },
      'registry-officer',
      fakeReq,
    );
    expect(result.requiresThirdMarker).toBe(false);
    expect(result.agreedMark).toBe(60);
    const reconciled = findEvent('second_marking.reconciled');
    expect(reconciled?.data).toEqual(expect.objectContaining({ force: true }));
  });

  it('propagates the agreed mark to the parent AssessmentAttempt.moderatedMark by default', async () => {
    await service.reconcileMarks('smr-1', {}, 'registry-officer', fakeReq);
    expect(mockedMarksService.update).toHaveBeenCalledWith(
      'attempt-1',
      expect.objectContaining({ moderatedMark: 66 }),
      'registry-officer',
      fakeReq,
    );
  });

  it('skips propagation to the parent AssessmentAttempt when propagateToAttempt:false', async () => {
    await service.reconcileMarks(
      'smr-1',
      { propagateToAttempt: false },
      'registry-officer',
      fakeReq,
    );
    expect(mockedMarksService.update).not.toHaveBeenCalled();
  });

  it('rejects reconciliation against an already-reconciled SecondMarkingRecord', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...baseRecord,
      completedDate: new Date('2026-04-04'),
      agreedMark: 66,
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    await expect(
      service.reconcileMarks('smr-1', {}, 'registry-officer', fakeReq),
    ).rejects.toThrow(ValidationError);
  });

  it('uses a custom toleranceThreshold when supplied', async () => {
    // 50 vs 70 — difference 20pp; supply tolerance of 25pp so reconciliation succeeds.
    mockedRepo.getById.mockResolvedValue({
      ...baseRecord,
      firstMarkerMark: 50,
      secondMarkerMark: 70,
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    const result = await service.reconcileMarks(
      'smr-1',
      { toleranceThreshold: 25 },
      'registry-officer',
      fakeReq,
    );
    expect(result.toleranceThreshold).toBe(25);
    expect(result.withinTolerance).toBe(true);
    expect(result.agreedMark).toBe(60);
    const reconciled = findEvent('second_marking.reconciled');
    expect(reconciled?.data).toEqual(
      expect.objectContaining({ toleranceThreshold: 25 }),
    );
  });

  it('captures reconciliationNotes on the audit + emitted event but does NOT persist them on the row', async () => {
    await service.reconcileMarks(
      'smr-1',
      { reconciliationNotes: 'Boundary case agreed by panel.' },
      'registry-officer',
      fakeReq,
    );
    const reconciled = findEvent('second_marking.reconciled');
    expect(reconciled?.data).toEqual(
      expect.objectContaining({
        reconciliationNotes: 'Boundary case agreed by panel.',
      }),
    );
    expect(mockedRepo.update).toHaveBeenCalledWith(
      'smr-1',
      // The persisted patch is JUST agreedMark + completedDate + updatedBy
      // — reconciliationNotes does not exist on the schema.
      expect.not.objectContaining({ reconciliationNotes: expect.anything() }),
    );
  });

  it('handles Decimal-as-string firstMark / secondMark (Prisma compat)', async () => {
    mockedRepo.getById.mockResolvedValue({
      ...baseRecord,
      firstMarkerMark: { toString: () => '65.00' },
      secondMarkerMark: { toString: () => '67.00' },
    } as unknown as Awaited<ReturnType<typeof repo.getById>>);
    const result = await service.reconcileMarks(
      'smr-1',
      {},
      'registry-officer',
      fakeReq,
    );
    expect(result.firstMarkerMark).toBeCloseTo(65);
    expect(result.secondMarkerMark).toBeCloseTo(67);
    expect(result.agreedMark).toBeCloseTo(66);
  });

  it('emits exactly one reconciled event and zero requires_third_marker events when within tolerance', async () => {
    await service.reconcileMarks('smr-1', {}, 'registry-officer', fakeReq);
    expect(findAllEvents('second_marking.reconciled')).toHaveLength(1);
    expect(findAllEvents('second_marking.requires_third_marker')).toHaveLength(0);
  });
});

describe('secondMarkingService.list / getById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('list resolves attemptId to (assessmentId, studentId) before delegating to the repo', async () => {
    mockedAttemptRepo.getById.mockResolvedValue(fakeAttempt as unknown as Awaited<ReturnType<typeof attemptRepo.getById>>);
    mockedRepo.list.mockResolvedValue({
      data: [],
      pagination: { limit: 25, total: 0, hasNext: false, nextCursor: null },
    } as unknown as Awaited<ReturnType<typeof repo.list>>);

    await service.list({
      cursor: undefined,
      limit: 25,
      sort: 'createdAt',
      order: 'desc',
      attemptId: 'attempt-1',
    });
    expect(mockedRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: 'assess-1',
        studentId: 'student-1',
      }),
      expect.objectContaining({ cursor: undefined, limit: 25 }),
    );
  });

  it('getById throws NotFoundError when the SecondMarkingRecord is missing', async () => {
    mockedRepo.getById.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toThrow(NotFoundError);
  });
});

describe('secondMarkingService.deriveStatus', () => {
  it('returns RECONCILED whenever a completedDate + agreedMark are present', () => {
    expect(
      service.deriveStatus({
        completedDate: new Date(),
        agreedMark: 66,
        createdAt: new Date('2026-04-02T10:00:00Z'),
        updatedAt: new Date('2026-04-04T10:00:00Z'),
      }),
    ).toBe('RECONCILED');
  });

  it('returns SECOND_MARKED whenever updatedAt is strictly after createdAt and not yet reconciled', () => {
    expect(
      service.deriveStatus({
        completedDate: null,
        agreedMark: null,
        createdAt: new Date('2026-04-02T10:00:00Z'),
        updatedAt: new Date('2026-04-03T10:00:00Z'),
      }),
    ).toBe('SECOND_MARKED');
  });

  it('returns ASSIGNED_TO_SECOND when the row is in the as-created shape', () => {
    const created = new Date('2026-04-02T10:00:00Z');
    expect(
      service.deriveStatus({
        completedDate: null,
        agreedMark: null,
        createdAt: created,
        updatedAt: created,
      }),
    ).toBe('ASSIGNED_TO_SECOND');
  });
});
